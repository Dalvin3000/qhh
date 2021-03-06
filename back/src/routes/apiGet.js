import { transaction, raw } from "objection";
import Interview from "../models/Interview";
import Candidate from "../models/Candidate";
import Tag from "../models/Tag";
import User from "../models/User";
import Message from "../models/Message";
import Attaches from "../models/Attache";
import { has } from "lodash";

export default router => {
  router.get("/", async (req, res) => {
    res.sendStatus(200);
  })
  // ---------------------------------------------------------------------------------------------
  router.get("/candidates", async (req, res) => {

    const ret = await Candidate.query()
      .distinct()
      .skipUndefined()
      .orderBy("id", "asc");

    res.send(ret);
  });

  // ---------------------------------------------------------------------------------------------
  router.get("/tags", async (req, res) => {
    let ret = await Tag.query()
      .distinct()
      .skipUndefined()
      .orderBy("priority");

    async function proc(arr) {
      // let r = [];
      for (const tag of arr) {
        const t = await Tag.query().findById(tag.id);

        if (!t) {
          throw createStatusCodeError(504);
        }

        const r = await t.$relatedQuery("candidates").skipUndefined();

        tag.size = r.length;
      }
    }

    await proc(ret);
    res.send(ret);
  });

  // ---------------------------------------------------------------------------------------------
  router.get("/candidates/:id", async (req, res) => {
    const ret = await Candidate.query()
      .where("candidates.id", req.params.id)
      .eager({
        attaches: true,
        tags: true,
        interviews: true
      })
      .distinct()
      .skipUndefined()
      .orderBy("id");

    res.send(ret);
  });

  // ---------------------------------------------------------------------------------------------
  router.get("/candidates/:id/duplicates", async (req, res) => {

    const candidate = await Candidate.query()
      .eager({
        attaches: true
      })
      .distinct()
      .skipUndefined()
      .where('id', '=', req.params.id)
      .orderBy("id", "asc");

    if (!candidate || candidate.length === 0) {
      res.send([]);
      return;
    }

    let names = [];
    const dupsByName = await Candidate.query()
      .whereNot({ id: req.params.id })
      .where({ name: candidate[0].name })

    let hashes = [], candidateAttIds = [], dupAttIds = [];
    candidate[0].attaches.forEach(att => {
      if (att.md5 && att.md5.length > 0)
        hashes = hashes.concat(att.md5);
      candidateAttIds = candidateAttIds.concat(att.id);
    })

    const dupsByHash1 = await Attaches.query()
      .where('md5', 'in', hashes);

    dupsByHash1.forEach(att => {
      if (!candidateAttIds.includes(att.id))
        dupAttIds = dupAttIds.concat(att.id);
    })
    let dupsAll = await Attaches.relatedQuery('candidates')
      .for(dupAttIds)

    dupsByName.forEach(dup => {
      if (! dupsAll.filter(dup2 => dup.id === dup2.id).length > 0)
        dupsAll = dupsAll.concat(item);
    })

    res.send(Array.from(dupsAll));
  });

  // ---------------------------------------------------------------------------------------------
  router.get("/tags/:tags/candidates", async (req, res) => {

    const tags = JSON.parse(req.params.tags);

    if (!tags || tags.length === 0) throw createStatusCodeError(404);

    const tagsInDB = await Tag.query()
      .whereIn("name", tags)
      .distinct()
      .orderBy("id", "desc");

    if (tagsInDB.length.length === 0) {
      res.send([]);
      return;
    }

    const tagsRes = await Tag.query()
      .eager({
        candidates: true
      })
      .whereIn("tags.name", tags)
      .orderBy("id", "desc");

    let longestCanList = [];
    let longestTagId = "";
    tagsRes.forEach((t, i) => {
      if (longestCanList.length < t.candidates.length) {
        longestCanList = t.candidates;
        longestTagId = t.id;
      }
    });

    let afterJoin = [];
    let needJoin = false;
    if (tags.length > 1) {
      needJoin = true;
      afterJoin = longestCanList.filter(lCand => {
        let cnt = 1;
        tagsRes.forEach(t => {
          if (t.id !== longestTagId)
            t.candidates.forEach(rCand => {
              if (lCand.id === rCand.id) {
                // console.error(lCand.id + "===" + rCand.id);
                cnt++;
              }
            });
        });
        return cnt === tags.length;
      });
    }

    const candidateListToSend = needJoin ? afterJoin : longestCanList;

    let ids = candidateListToSend.map(c => {
      return c.id;
    });

    let q = await Candidate.query()
      .findByIds(ids)
      .eager({
        attaches: true,
        tags: true,
        interviews: true
      });

    res.send(q);
  });

  // ---------------------------------------------------------------------------------------------
  router.get("/logout", async (req, res) => {
    // if (!req.session || !req.session.user) {
    //   res.sendStatus(401);
    //   return;
    // }
    console.log(req.session.credentials)
    req.session.destroy();
    res.sendStatus(200);
  });

  // ---------------------------------------------------------------------------------------------
  router.get("/users", async (req, res) => {

    const ret = await User.query()
      .skipUndefined()
      .orderBy("id");

    ret.forEach((r, i) => {
      delete ret[i].pass;
    });
    res.send(ret);
  });

  // ---------------------------------------------------------------------------------------------
  router.get("/interviews", async (req, res) => {

    const ret = await Interview.query()
      .eager({
        welcomeUser: true,
        interviewer: true,
        candidates: true
      })
      .orderBy("id");

    ret.forEach((r, i) => {
      // console.error(r);
      ret[i].welcomeUser =
        r.welcomeUser.length > 0 ? r.welcomeUser.filter(e => e.id > 0) : "";
      ret[i].candidate =
        r.candidates.length > 0 ? r.candidates.filter(e => e.id > 0) : {};
      ret[i].interviewer =
        r.interviewer.length > 0 ? r.interviewer.filter(e => e.id > 0) : "";
      delete ret[i].candidates;
    });

    res.send(ret);
  });

  // ---------------------------------------------------------------------------------------------
  router.get("/users/:id/interviews", async (req, res) => {

    const user = await User.query().findById(req.params.id);

    if (!user) {
      throw createStatusCodeError(404);
    }

    const ret = await user.$relatedQuery("interviews").skipUndefined();

    res.send(ret);
  });

  // ---------------------------------------------------------------------------------------------
  router.get("/messages/:id", async (req, res) => {

    const ret = await Message.query()
      .joinRelation("candidates")
      .eager({
        users: true,
        candidates: true
      })
      .where("candidates.id", req.params.id)
      .distinct()
      .skipUndefined()
      .orderBy("created");

    res.send(ret);
  });

  // ---------------------------------------------------------------------------------------------
  router.get("/messages/:fromDate/system", async (req, res) => {

    let fromDate = req.params.fromDate;

    /*
        0 - User chat messages,
        1 - new candidate,
        2 - candidate tags changes,
        3 - new tags,
        4 - new interview,
        5 - interview changes
        6 - delete interview
         */
    const ret = await Message.query().where(
      raw("`created` > FROM_UNIXTIME( '" + fromDate + "' )")
    );
    // .andWhere('type', '!=',0);

    res.send(ret);
  });

  // ---------------------------------------------------------------------------------------------
  router.get("/messages/:lastId/system/fromId", async (req, res) => {

    let lastMsgId = req.params.lastId;

    const ret = await Message.query()
      .eager({
        users: true,
        candidates: true
      })
      .where("id", ">", lastMsgId)
      .skipUndefined();
    // .andWhere('isSystem', 1);
    res.send(ret);
  });

  router.get("/userInfo", async (req, res) => {

    const ret = await User.query().where("id", req.session.credentials.id);
    ret.forEach((i) => { delete i.pass });

    res.send(ret);
  });
};

function createStatusCodeError(statusCode) {
  return Object.assign(new Error(), {
    statusCode
  });
}
