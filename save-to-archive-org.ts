import { Application, Router, Context } from "https://deno.land/x/oak/mod.ts";
import { PostgrestClient } from "https://cdn.skypack.dev/@supabase/postgrest-js";

function urlTest(url: string) {
  try {
    new URL(url);
    return true;
  } catch (error) {
    return false;
  }
}

function removeTrackParm(_url: string) {
  // https://github.com/AdguardTeam/AdguardFilters/tree/master/TrackParamFilter/sections
  const general = [
    "nx_source",
    "_zucks_suid",
    "cmpid",
    "asgtbndr",
    "guccounter",
    "guce_referrer",
    "guce_referrer_sig",
    "_openstat",
    "action_object_map",
    "action_ref_map",
    "action_type_map",
    "fb_action_ids",
    "fb_action_types",
    "fb_comment_id",
    "fb_ref",
    "fb_source",
    "fbclid",
    "xtor",
    "utm_campaign",
    "utm_channel",
    "utm_cid",
    "utm_content",
    "utm_id",
    "utm_medium",
    "utm_name",
    "utm_place",
    "utm_pubreferrer",
    "utm_reader",
    "utm_referrer",
    "utm_serial",
    "utm_social",
    "utm_social-type",
    "utm_source",
    "utm_swu",
    "utm_term",
    "utm_userid",
    "utm_viz_id",
    "utm_product",
    "utm_campaignid",
    "utm_ad",
    "utm_brand",
    "utm_emcid",
    "utm_emmid",
    "utm_umguk",
    "gbraid",
    "wbraid",
    "gclsrc",
    "gclid",
    "yclid",
    "dpg_source",
    "dpg_campaign",
    "dpg_medium",
    "dpg_content",
    "admitad_uid",
    "adjust_tracker",
    "adjust_adgroup",
    "adjust_campaign",
    "bsft_clkid",
    "bsft_eid",
    "bsft_mid",
    "bsft_uid",
    "bsft_aaid",
    "bsft_ek",
    "mtm_campaign",
    "mtm_cid",
    "mtm_content",
    "mtm_group",
    "mtm_keyword",
    "mtm_medium",
    "mtm_placement",
    "mtm_source",
    "pk_campaign",
    "pk_medium",
    "pk_source",
    "_branch_match_id",
    "vc_lpp",
    "ml_subscriber",
    "ml_subscriber_hash",
    "rb_clickid",
    "oly_anon_id",
    "oly_enc_id",
    "dt_dapp",
    "dt_platform",
    "spm",
    "scm",
    "dclid",
  ];

  const specific: Record<string, string[]> = {
    "bilibili.com": [
      "from",
      "seid",
      "share_source",
      "spm_id_from",
      "from_spm_id",
      "share_medium",
      "share_plat",
      "share_session_id",
      "share_source",
      "share_tag",
      "timestamp",
      "unique_k",
      "from_source",
      "refer_from",
    ],
    "douban.com": ["_i"],
    "mp.weixin.qq.com": ["chksm", "key", "uin", "devicetype", "exportkey"],
    "twitter.com": ["ref_src", "ref_url"],
    "reddit.com": ["correlation_id", "ref_campaign", "ref_source", "ref"],
    "weidian.com": ["distributorid", "wfr", "ifr", "share_relation", "source"],
    "instagram.com": ["igshid"],
    "steampowered.com": ["curator_clanid"],
    "steamcommunity.com": ["curator_clanid"],
    "linkedin.com": ["trkInfo", "originalReferer"],
    "nicovideo.jp": ["cmnhd_ref", "ref"],
    "www.baidu.com": ["rsv_pq", "rsv_t"],
    "nytimes.com": ["impression_id"],
  };

  function findSpecial(host: string) {
    let lastPos = 0;
    let domain = host;
    while (lastPos >= 0) {
      if (specific[domain]) {
        return specific[domain];
      }
      lastPos = host.indexOf(".", lastPos + 1);
      domain = host.slice(lastPos + 1);
    }
  }

  const url = new URL(_url);
  const host = url.hostname;
  const search = url.searchParams;
  general.forEach((s) => search.delete(s));
  const special = findSpecial(host);
  if (special) {
    special.forEach((s) => search.delete(s));
  }
  url.hash = "";
  return url.href;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(undefined);
    }, ms);
  });
}

interface dataBaseData {
  original_url: string;
  timestamp: number;
  archive_url: string;
}
class Cache {
  private postgrest: PostgrestClient;
  private tableName: string;

  constructor() {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    if (!(SUPABASE_URL && SUPABASE_ANON_KEY)) {
      throw new Error("Can't get SUPABASE_URL or SUPABASE_ANON_KEY");
    }
    const postgrest = new PostgrestClient(
      `${SUPABASE_URL}/rest/v1`,
      // @ts-ignore:types
      {
        // @ts-ignore:args
        fetch: (...args) => fetch(...args),
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );
    this.postgrest = postgrest;
    this.tableName = "archive-org";
  }

  public async get(url: string): Promise<
    | {
        status: number;
        firstVersionTime: number;
        firstVersionUrl: string;
        recentVersionTime: number;
        recentVersionUrl: string;
      }
    | undefined
  > {
    // @ts-ignore: any
    const { data, error } = await this.postgrest
      .from(this.tableName)
      .select("original_url, timestamp, archive_url")
      .eq("original_url", url);
    if (error) {
      console.error(error);
      return undefined;
    }
    if ((data as dataBaseData[]).length === 0) {
      return undefined;
    }

    console.log(`Read from cache ${url}.`);
    const datas = (data as dataBaseData[])
      .map((d) => {
        d.timestamp = new Date(d.timestamp).getTime();
        return d;
      })
      .sort((a: dataBaseData, b: dataBaseData) => {
        return a.timestamp - b.timestamp;
      });
    const first = datas[0];
    const recent = datas.slice(-1)[0];
    const out = {
      status: 200,
      firstVersionTime: first.timestamp,
      firstVersionUrl: first.archive_url,
      recentVersionTime: recent.timestamp,
      recentVersionUrl: recent.archive_url,
    };
    return out;
  }

  public async put(datas: dataBaseData[]) {
    const commits = [];
    for (const data of datas) {
      const { original_url, timestamp, archive_url } = data;
      if (
        typeof original_url === "string" &&
        typeof timestamp === "number" &&
        typeof archive_url === "string"
      ) {
        console.log(
          `Put to cahce: ${original_url}, ${timestamp}, ${archive_url}`
        );
        commits.push({
          original_url,
          timestamp: new Date(timestamp).toISOString(),
          archive_url,
        });
      } else {
        console.error(
          `Put to cahce error: ${original_url}, ${timestamp}, ${archive_url}`
        );
      }
    }
    // @ts-ignore: any
    const { data, error } = await this.postgrest
      .from(this.tableName)
      .insert(commits);
    if (error) {
      console.error(error);
      return undefined;
    }
    return data;
  }
}
const cache = new Cache();

class archiveOrg {
  protected baseUrl: string;
  protected url: string;
  protected headers: Headers;
  protected _status?: number; //200 | 403 | 404 | 500;
  protected _firstVersionTime?: number;
  protected _firstVersionUrl?: string;
  protected _recentVersionTime?: number;
  protected _recentVersionUrl?: string;

  constructor(
    url: string,
    headers: {
      "User-Agent": string;
      "Accept-Language": string;
    }
  ) {
    this.baseUrl = "https://web.archive.org";
    this.headers = new Headers({
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      ...headers,
    });
    if (urlTest(url) && url.startsWith("http")) {
      this.url = removeTrackParm(url);
    } else {
      throw new Error("URL schema error! " + url);
    }
  }

  public async query(): Promise<
    | {
        status: number;
        firstVersionTime: number;
        firstVersionUrl: string;
        recentVersionTime: number;
        recentVersionUrl: string;
      }
    | {
        status: number | undefined;
      }
  > {
    const self = this;

    const out = await readFromCache();
    if (
      out !== undefined &&
      Math.abs(out.recentVersionTime - Date.now()) / 1000 / 3600 / 24 < 1
    ) {
      return out;
    }

    const first = `${self.baseUrl}/web/0/${self.url}`;
    const recent = `${self.baseUrl}/web/2/${self.url}`;
    await get(first, "first");
    await get(recent, "recent");
    if (self._status === 200) {
      const out = {
        status: self._status,
        firstVersionTime: self._firstVersionTime,
        firstVersionUrl: self._firstVersionUrl,
        recentVersionTime: self._recentVersionTime,
        recentVersionUrl: self._recentVersionUrl,
      };
      putToCache(out as Out);
      return out;
    } else {
      return {
        status: self._status,
      };
    }

    async function get(url: string, type: "first" | "recent"): Promise<void> {
      const resp = await fetch(url, {
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          ...self.headers,
        },
      });
      if (resp.status === 200) {
        const u = resp.url;
        const _time = u.substring(28, u.indexOf("/", 28));
        const time = self.convertTimeStamp(_time);
        const urlKey = ("_" + type + "VersionUrl") as
          | "_firstVersionUrl"
          | "_recentVersionUrl";
        const timeKey = ("_" + type + "VersionTime") as
          | "_firstVersionTime"
          | "_recentVersionTime";
        self._status = 200;
        self[urlKey] = u;
        self[timeKey] = time;
      }
      self._status = resp.status;
    }

    interface Out {
      status: number;
      firstVersionTime: number;
      firstVersionUrl: string;
      recentVersionTime: number;
      recentVersionUrl: string;
    }
    async function putToCache(out: Out) {
      const commits = [
        {
          original_url: self.url,
          timestamp: out.firstVersionTime,
          archive_url: out.firstVersionUrl,
        },
      ];
      if (out.recentVersionTime !== out.firstVersionTime) {
        commits.push({
          original_url: self.url,
          timestamp: out.recentVersionTime,
          archive_url: out.recentVersionUrl,
        });
      }
      await cache.put(commits);
    }

    async function readFromCache() {
      const obj = await cache.get(self.url);
      if (obj !== undefined) {
        self._status = 200;
        self._firstVersionTime = obj.firstVersionTime;
        self._firstVersionUrl = obj.firstVersionUrl;
        self._recentVersionTime = obj.recentVersionTime;
        self._recentVersionUrl = obj.recentVersionUrl;
      }

      return obj;
    }
  }

  public async save(): Promise<
    | {
        status: number;
        archive_status: string;
        original_url: string | undefined;
        first_archive: boolean | undefined;
        timestamp: number;
        archive_url: string;
        duration_sec: number | undefined;
      }
    | { status: number; archive_status: string; original_url: string }
  > {
    const self = this;

    console.log(`Start save ${self.url}`);
    const spnId = await submit();
    const out = await wait(spnId);
    putToCache(out as Out);
    return out;

    async function submit(): Promise<string> {
      const url = `${self.baseUrl}/save/${self.url}`;
      const headers = {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded",
        ...self.headers,
      };
      const body = {
        url: self.url,
        capture_all: "on",
      };
      const req = await fetch(url, {
        headers,
        keepalive: true,
        referrer: `${self.baseUrl}/save`,
        method: "POST",
        body: new URLSearchParams(body).toString(),
      });
      const text = await req.text();
      const spn = /spn\.watchJob\("([\w\-]+)/.exec(text)?.[1];
      if (spn) {
        return spn;
      } else {
        throw new Error(`extract spn id error! ${self.url}`);
      }
    }
    async function wait(spn: string): Promise<
      | {
          status: number;
          archive_status: string;
          original_url: string | undefined;
          first_archive: boolean | undefined;
          timestamp: number;
          archive_url: string;
          duration_sec: number | undefined;
        }
      | { status: number; archive_status: string; original_url: string }
    > {
      const getUrl = () => {
        const u = new URL(`${self.baseUrl}/save/status/${spn}`);
        u.searchParams.set("_t", Date.now().toString());
        return u.href;
      };
      let currentStatus = "pending";
      while (currentStatus === "pending") {
        await sleep(2000);
        const headers = {};
        Object.assign(headers, self.headers);
        Object.assign(headers, {
          Accept: "*/*",
          "X-Requested-With": "XMLHttpRequest",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
        });
        const req = await fetch(getUrl(), {
          headers,
          keepalive: true,
          referrer: `${self.baseUrl}/save/${self.url}`,
        });
        interface SaveStatus {
          resources: string[];
          job_id: string;
          status: "pending" | "success";
          counters?: {
            outlinks: number;
            embeds: number;
          };
          original_url?: string;
          first_archive?: boolean;
          duration_sec?: number;
          timestamp: string;
        }
        const data = (await req.json()) as SaveStatus;
        currentStatus = data.status;

        if ((currentStatus as string) === "success") {
          const archive_url = `${self.baseUrl}/web/${data.timestamp}/${self.url}`;
          self._status = 200;
          self._recentVersionUrl = archive_url;
          self._recentVersionTime = self.convertTimeStamp(data.timestamp);
          const result = {
            status: self._status,
            archive_status: currentStatus,
            original_url: data.original_url,
            first_archive: data.first_archive,
            timestamp: self.convertTimeStamp(data.timestamp),
            archive_url,
            duration_sec: data.duration_sec,
          };
          console.log(JSON.stringify(result));
          return result;
        }
      }
      self._status = 500;
      const result = {
        status: self._status,
        archive_status: currentStatus,
        original_url: self.url,
      };
      console.log(JSON.stringify(result));
      return result;
    }

    interface Out {
      status: number;
      archive_status: string;
      original_url: string;
      first_archive: boolean;
      timestamp: number;
      archive_url: string;
      duration_sec: number;
    }
    async function putToCache(out: Out) {
      if (out.original_url && out.timestamp && out.archive_url) {
        await cache.put([
          {
            original_url: out.original_url,
            timestamp: out.timestamp,
            archive_url: out.archive_url,
          },
        ]);
      }
    }
  }

  public async saveOnlyNone(): Promise<
    | {
        status: number;
        archive_status: string;
        original_url: string | undefined;
        first_archive: boolean | undefined;
        timestamp: number;
        archive_url: string;
        duration_sec: number | undefined;
      }
    | { status: number; archive_status: string; original_url: string }
    | {
        status: number;
        firstVersionTime: number;
        firstVersionUrl: string;
        recentVersionTime: number;
        recentVersionUrl: string;
      }
    | {
        status: number | undefined;
      }
  > {
    const q = await this.query();
    if (this._status === 404) {
      return await this.save();
    }
    if (this._status === 200) {
      const moreThanOndDay =
        Math.abs((this._recentVersionTime as number) - Date.now()) /
          1000 /
          3600 /
          24 >
        3;
      if (moreThanOndDay) {
        return await this.save();
      } else {
        return q;
      }
    }
    return q;
  }

  private convertTimeStamp(_time: string): number {
    const _date = /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/
      .exec(_time)
      ?.slice(1)
      .map((n) => parseInt(n));
    if (_date) {
      _date[1] = _date[1] - 1;
      // @ts-ignore:A spread argument must either have a tuple type or be passed to a rest parameter.
      const time = Date.UTC(..._date);
      return time;
    }
    throw new Error("convert timestamp failed! " + _time);
  }

  public get status() {
    return this._status;
  }

  public get firstVersionTime() {
    return this._firstVersionTime;
  }

  public get firstVersionUrl() {
    return this._firstVersionUrl;
  }

  public get recentVersionTime() {
    return this._recentVersionTime;
  }

  public get recentVersionUrl() {
    return this._recentVersionUrl;
  }
}

function getBaseHeader() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "2073600",
    "X-Request-id": crypto.randomUUID(),
  };
}

function log(
  ctx: Context,
  additions: Record<string, string> = {},
  level = "info"
) {
  const logObj = {
    time: new Date().toISOString(),
    level,
    ip: ctx.request.ip,
    request: {
      url: ctx.request.url,
      method: ctx.request.method,
      headers: [...ctx.request.headers.entries()],
    },
    response: {
      status: ctx.response.status,
      headers: [...ctx.response.headers.entries()],
    },
    additions: { ...additions },
  };
  console.log(JSON.stringify(logObj));
}

function error(ctx: Context, status = 400) {
  ctx.response.status = status;
  ctx.response.headers = new Headers(getBaseHeader());
  return log(ctx, {}, "error");
}

function ip(ctx: Context) {
  const ip = ctx.request.ip;
  const body = {
    origin: ip,
  };
  ctx.response.headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    ...getBaseHeader(),
  });
  ctx.response.body = body;
  return log(ctx);
}

function getRequestHeaders(ctx: Context) {
  const headers = ctx.request.headers;
  return {
    "User-Agent":
      headers.get("User-Agent") ??
      "Mozilla/5.0 (X11; Linux x86_64; rv:95.0) Gecko/20100101 Firefox/95.0",
    "Accept-Language": headers.get("Accept-Language") ?? "en-US,en;q=0.5",
  };
}
function queryParamsCheck(ctx: Context) {
  const params = ctx.request.url.searchParams;
  const url = params.get("url");
  if (url) {
    return urlTest(url);
  }
  return false;
}
async function query(ctx: Context) {
  if (!queryParamsCheck(ctx)) {
    return error(ctx);
  }
  const params = ctx.request.url.searchParams;
  const url = params.get("url") as string;
  const archive = new archiveOrg(url, getRequestHeaders(ctx));
  const body = await archive.query();
  ctx.response.headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    ...getBaseHeader(),
  });
  ctx.response.body = JSON.stringify(body);
  return log(ctx, {
    url,
  });
}

interface saveBody {
  url: string;
}
function saveBodyCheck(body: object) {
  const entries = Object.entries(body);
  if (entries.length === 1) {
    const entry = entries[0];
    if (entry[0] === "url" && urlTest(entry[1])) {
      const url = entry[1] as string;
      if (!url.startsWith("https://web.archive.org/")) {
        return true;
      }
    }
  }
  return false;
}
async function save(ctx: Context) {
  if (ctx.request.hasBody) {
    const body = await ctx.request.body({ type: "json" }).value;
    if (!saveBodyCheck(body)) {
      return error(ctx);
    }
    const url = (body as saveBody).url;
    const archive = new archiveOrg(url, getRequestHeaders(ctx));
    let responseBody;
    try {
      responseBody = await archive.saveOnlyNone();
    } catch (err) {
      console.error(err);
      return error(ctx, 500);
    }
    ctx.response.headers = new Headers({
      "content-type": "application/json; charset=utf-8",
      ...getBaseHeader(),
    });
    ctx.response.body = JSON.stringify(responseBody);
    return log(ctx, {
      url,
      status: responseBody.status?.toString() ?? "",
    });
  } else {
    return error(ctx);
  }
}

const router = new Router();
router.get("/", (ctx) => {
  ctx.response.headers = new Headers(getBaseHeader());
  ctx.response.redirect("/ip");
});
router.get("/ip", ip);

router.get("/query", query);

router.get("/save", (ctx) => {
  ctx.response.status = 405;
  ctx.response.headers = new Headers(getBaseHeader());
});
router.options("/save", (ctx) => {
  ctx.response.status = 204;
  ctx.response.headers = new Headers(getBaseHeader());
});
router.post("/save", save);

const app = new Application();
app.use(router.routes());
await app.listen({ port: 8000 });

app.addEventListener("error", (error) => console.error(error));
