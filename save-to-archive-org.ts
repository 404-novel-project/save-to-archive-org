import { Application, Router, Context } from "https://deno.land/x/oak/mod.ts";

function urlTest(url: string) {
  try {
    new URL(url);
    return true;
  } catch (error) {
    return false;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(undefined);
    }, ms);
  });
}

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
      this.url = url;
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
    const first = `${self.baseUrl}/web/0/${self.url}`;
    const recent = `${self.baseUrl}/web/2/${self.url}`;
    await get(first, "first");
    await get(recent, "recent");
    if (self._status === 200) {
      return {
        status: self._status,
        firstVersionTime: self._firstVersionTime,
        firstVersionUrl: self._firstVersionUrl,
        recentVersionTime: self._recentVersionTime,
        recentVersionUrl: self._recentVersionUrl,
      };
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
    const spnId = await submit();
    return await wait(spnId);

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
    async function wait(spn: string) {
      const getUrl = () => {
        const u = new URL(`${self.baseUrl}/save/status/${spn}`);
        u.searchParams.set("_t", Date.now().toString());
        return u.href;
      };
      let currentStatus = "pending";
      while (currentStatus === "pending") {
        await sleep(2000);
        const req = await fetch(getUrl(), {
          headers: {
            Accept: "*/*",
            "X-Requested-With": "XMLHttpRequest",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            ...self.headers,
          },
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
        ((this._recentVersionTime as number) - Date.now()) / 1000 / 3600 / 24 >
        1;
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

function uuidv4() {
  // @ts-ignore: https://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c: number) =>
    (
      c ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
    ).toString(16)
  );
}
function getBaseHeader() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "2073600",
    "X-Request-id": uuidv4(),
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
