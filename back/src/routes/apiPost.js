import { transaction, raw } from 'objection';
import Interview from "../models/Interview";
import Candidate from "../models/Candidate";
import Tag from "../models/Tag";
import User from "../models/User";
import Message from "../models/Message";
import moment from "moment/moment";
import cors from 'cors';

import loginLdap from "../ldap/client";

var multer = require('multer');
var upload = multer({ dest: __dirname + process.env.UPLOADS_POSTFIX });
var type = upload.array('upl');

var fs = require('fs');

export default router => {

    router.post("/post-test", cors(), async (req, res) => {
        !req.session.views ? req.session.views = 1 : req.session.views++;
        console.log("post-test end");
        res.sendStatus(200);
    });

    router.post("/login", async (req, res) => {
        const credentials = req.body;

        console.log("post login: " + JSON.stringify(credentials.login));
        if (!credentials.login && !credentials.pass && !req.session.credentials) {
            throw createStatusCodeError(504);
        }

        if (req.session.credentials) {
            console.log(req.session.credentials);
            console.log("session time: " + req.session.cookie.maxAge / 1000);

            const users = await User.query()
                .where('login', req.session.credentials.login)

            if (users.length > 0) {
                console.log("login found in db. auth is ok!");
                res.send(users);
                return;
            }
        }


        req.session.credentials = {};
        req.session.credentials.login = credentials.login;
        req.session.save();
        function ldapAuth(credentials) {
            console.log("ldap1 ");
            const _ldap = loginLdap(credentials.login, credentials.pass, async (ldapAccessOk) => {
                if (ldapAccessOk) {
                    console.log("ldap2: " + _ldap);

                    console.log("add user to cache: " + credentials.login);

                    const users = await User.query()
                        .where('login', credentials.login)

                    if (users.length > 0) {
                        console.log("login found in db. auth is ok!");
                        req.session.credentials.login = users[0].login;
                        req.session.credentials.id = users[0].id;
                        console.log(req.session.credentials);
                        // req.session.save();
                        res.send(users);
                    }

                } else {
                    res.sendStatus(401);
                }
            });

        }
        ldapAuth(credentials)

    });


    // ---------------------------------------------------------------------------------------------
    router.post('/candidateFromAttache', type, async (req, res) => {

        const cred = req.session.credentials;

        if (!req.files || req.files.length === 0)
            res.sendStatus(505);

        let graph = [];
        req.files.forEach((f) => {
            let a = f.originalname.split('.');
            const ext = a.length > 0 ? a[a.length - 1] : "pdf";
            fs.rename(f.path, f.path + "." + ext, (err) => {
                if (err) throw err;
            });
            // console.log(f);
            graph = graph.concat([{
                name: f.originalname.toLowerCase().replace(/pdf|svg|png|jpg|jpeg/g, '').replace(/[\!\@\#\$\%\^\&\*\(\)\+\"\№\;\%\:\?\*\-\+\/\\\{\}\d\,\.\|]/g, ''),
                attaches: [{
                    name: f.originalname,
                    filename: f.filename + "." + ext
                }]
            }]);
        });

        // check duplicates
        // let names = [];
        // graph.forEach(async (gCandidate) => {
        //     const can = await Candidate.query()
        //         .where({ name: gCandidate.name })
        //         .then();
        //     if (can.length > 0) {
        //         console.warn("duplicates: " + can.name);
        //     }
        // });
        // ------

        const insertedGraph = await
            transaction(Candidate.knex(), trx => {
                return Candidate.query(trx).insertGraph(graph);
            });

        insertedGraph.forEach((cand) => {
            addSystemMessage("Candidate added", 1, cred.id, cand.id).then();
        });

        res.send(insertedGraph);
    });

    // ---------------------------------------------------------------------------------------------
    /* Input:
        {
        "id": 383,
        "name": "irz_logo",
        "tags": [
        {
            "id": 34,
            "name": "cpp",
            "color": "0",
            "priority": 50
        },
        {
            "id": 51,
            "name": "interview",
            "color": "ef2d56",
            "priority": 130,
            "size": 3
        }]
        }
     */
    router.post('/tags/update', async (req, res) => {

        let candidateInfo = req.body;
        if (!candidateInfo || !candidateInfo.tags) {
            throw createStatusCodeError(505);
        }

        // console.error(candidateInfo.tags);

        // Selecting only new tags
        let tags = candidateInfo.tags.slice(0, candidateInfo.tags.length);

        let ttt = await Tag.query();
        ttt.forEach((existTag) => {
            tags.forEach((reqTag, i) => {
                if (existTag.name === reqTag.name) {
                    tags.splice(i, 1);
                    return;
                }
            })
        });

        // Insert new tags in DB
        if (tags && tags.length > 0) {
            console.error("New tags found! Size: " + tags.length)
            let t = await Tag.query().upsertGraph(tags, {
                relate: false,
                insertMissing: true,
                noInsert: false,
                update: true
            });
        }

        // Select all tags (with tagID!) for candidate
        let allTagsId = await Tag.query();
        let retTags = [];
        allTagsId.forEach((existTag) => {
            candidateInfo.tags.forEach((reqTag, i) => {
                if (existTag.name === reqTag.name) {
                    retTags = retTags.concat(existTag);
                    return;
                }
            })
        });
        candidateInfo.tags = retTags;

        // Flush all relations between current candidate and tags
        let c = await Candidate.query()
            .upsertGraph({ id: candidateInfo.id, tags: null }, {
                relate: true,
                unrelate: true,
                update: false,
                noUpdate: false,
                noInsert: false,
                noDelete: false
            });

        // Insert new relations between current candidate and tags
        let ret = await Candidate.query()
            .upsertGraph(candidateInfo, { relate: true, noUpdate: false, noInsert: true });

        // Create new system message
        const body = candidateInfo.tags.map((m) => {
            return m.name
        }).join(", ")
        addSystemMessage("Tags changed to [ " + body + " ]", 2, req.session.credentials.id, candidateInfo.id).then();

        res.send(ret);
    });


    // ---------------------------------------------------------------------------------------------
    /* Input:
        {
        "begin": "2018-07-18 12:17",
        "desc": "",
        "welcomeUser": [
        {
            "id": 1,
            "login": "ed",
            "description": "empty",
            "ip": null,
            "lastMessageId": 70
        }],
        "interviewer": [
        {
            "id": 1,
            "login": "ed",
            "description": "empty",
            "ip": null,
            "lastMessageId": 70
        }],
        "candidates": [
        {
            "id": 383,
            "created": "2018-07-16T05:31:35.000Z",
            "updated": "2018-07-16T05:31:35.000Z",
            "name": "irz_logo",
            "tel": null,
            "email": null,
            "im": null,
        }]
        }
     */
    router.post('/interview/', async (req, res) => {

        let interview = req.body;
        console.log(interview);
        if (!interview || !interview.candidates || !interview.begin) {
            throw createStatusCodeError(505);
        }

        let q = {
            begin: interview.begin,
            desc: interview.desc,

        };

        console.log(q);
        let ret = await Interview.query()
            .upsertGraph(q, {                 
                relate: true,
                unrelate: true,
                update: false,
                noUpdate: false,
                noInsert: false,
                noDelete: false });

        console.log(ret);

        q = { 
            candidates: [{ id: interview.candidates[0].id }],
            welcomeUser: [{ id: interview.welcomeUser[0].id }],
            interviewer: [{ id: interview.interviewer[0].id }]
            }
        let ret2 = await Interview.query()
        .upsertGraph(q, {                 
            relate: true,
            update: true,
            noUpdate: false,
            noInsert: true,
            noDelete: true });
        
        console.log(ret2);
        // Create new system message
        const msg = addSystemMessage("Interview is scheduled for: " + moment(interview.begin).format("YY.MM.DD HH:mm") +
            ", interviewer: " + interview.interviewer[0].login,
            5, req.session.credentials.id, interview.candidates[0].id);

        console.log(msg);

        res.send(ret);
    });


    // ---------------------------------------------------------------------------------------------
    /* Input:
            {
            "body": "1",
            "type": 0,
            "users": [{
                "id": 1
            }],
            "candidates": [{
                "id": 383
            }]
            }
     */
    router.post('/messages/', async (req, res) => {

        let message = req.body;
        if (!message || !message.candidates || !message.users) {
            throw createStatusCodeError(504);
        }

        const ret = await Message.query()
            .upsertGraph(message, { relate: true, noUpdate: false, noInsert: false });

        res.send(ret);
    });

    // ---------------------------------------------------------------------------------------------
    router.post('/messages/readTo/:lastMsgId', async (req, res) => {

        const lastMsgId = parseInt(req.params.lastMsgId);
        if (!Number.isInteger(lastMsgId))
            return;

        await User.query()
            .where({ id: req.session.credentials.id })
            .update({ lastMessageId: lastMsgId }).then();

        res.sendStatus(200);
    });


    // ---------------------------------------------------------------------------------------------
    router.post('/interview/:id/delete', async (req, res) => {

        let interviewId = req.params.id;

        const cand = await Candidate.query()
            .joinRelation('interviews')
            .eager({
                interviews: true
            })
            .where('interviews.id', interviewId)
            .andWhere('candidates.id', "!=", 0)
            .distinct()
            .skipUndefined().then();

        const ret = await Interview.query()
            .delete()
            .where({ id: interviewId }).then();

        if (parseInt(ret) === 1) {
            let intTime = null;
            cand[0].interviews.forEach((iview) => {
                console.log(iview.id);
                if (iview.id === parseInt(interviewId))
                    intTime = moment(iview.begin).format("YY.MM.DD HH:mm");
            });
            addSystemMessage("Interview [ " + interviewId + " at " + intTime + " ] canceled",
                6, req.session.credentials.id, cand[0].id).then();
            res.send(200);
        } else res.sendStatus(400);
    });

    async function addSystemMessage(msgBody, msgType, userId, candidateId) {
        const message = {
            body: msgBody,
            type: msgType,
            users: [{
                id: userId
            }],
            candidates: [{
                id: candidateId
            }]
        };

        console.error(message);
        return await Message.query()
            .upsertGraph(message, { relate: true, noUpdate: false, noInsert: false });
    }

    function createStatusCodeError(statusCode) {
        return Object.assign(new Error(), {
            statusCode
        });
    }
}