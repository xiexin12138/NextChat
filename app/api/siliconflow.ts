import { getServerSideConfig } from "@/app/config/server";
import {
  SILICONFLOW_BASE_URL,
  ApiPath,
  ModelProvider,
  ServiceProvider,
} from "@/app/constant";
import { prettyObject } from "@/app/utils/format";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/api/auth";
import { isModelNotavailableInServer } from "@/app/utils/model";

const serverConfig = getServerSideConfig();

export async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  console.log("[SiliconFlow Route] params ", params);

  console.log("[SiliconFlow] req", req);
  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  const authResult = auth(req, ModelProvider.SiliconFlow);
  console.log("[SiliconFlow] authResult ", authResult);

  if (authResult.error) {
    return NextResponse.json(authResult, {
      status: 401,
    });
  }

  try {
    const response = await request(req);
    console.log("[SiliconFlow] response", JSON.stringify(response));
    return response;
  } catch (e) {
    console.error("[SiliconFlow] error", e);
    return NextResponse.json(prettyObject(e));
  }
}

async function request(req: NextRequest) {
  const controller = new AbortController();

  // alibaba use base url or just remove the path
  let path = `${req.nextUrl.pathname}`.replaceAll(ApiPath.SiliconFlow, "");

  let baseUrl = serverConfig.siliconFlowUrl || SILICONFLOW_BASE_URL;

  if (!baseUrl.startsWith("http")) {
    baseUrl = `https://${baseUrl}`;
  }

  if (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }

  console.log("[Proxy] ", path);
  console.log("[Base Url]", baseUrl);

  const timeoutId = setTimeout(
    () => {
      controller.abort();
    },
    10 * 60 * 1000,
  );

  const fetchUrl = `${baseUrl}${path}`;
  const fetchOptions: RequestInit = {
    headers: {
      "Content-Type": "application/json",
      Authorization: req.headers.get("Authorization") ?? "",
    },
    method: req.method,
    body: req.body,
    redirect: "manual",
    // @ts-ignore
    duplex: "half",
    signal: controller.signal,
  };

  console.log("[siliconflow] fetchOptions", fetchOptions);

  // #1815 try to refuse some request to some models
  if (serverConfig.customModels && req.body) {
    try {
      const clonedBody = await req.text();
      fetchOptions.body = clonedBody;

      const jsonBody = JSON.parse(clonedBody) as { model?: string };
      const notAvailableModel = isModelNotavailableInServer(
        serverConfig.customModels,
        jsonBody?.model as string,
        ServiceProvider.SiliconFlow as string,
      );
      console.log("🚀 ~ request ~ notAvailableModel:", notAvailableModel);

      // not undefined and is false
      if (notAvailableModel) {
        return NextResponse.json(
          {
            error: true,
            message: `you are not allowed to use ${jsonBody?.model} model`,
          },
          {
            status: 403,
          },
        );
      }
    } catch (e) {
      console.error(`[SiliconFlow] filter`, e);
    }
  }
  try {
    const res = await fetch(fetchUrl, fetchOptions);
    console.log("🚀 ~ request ~ fetchUrl:", fetchUrl);
    console.log("[siliconflow] res.body:", res.body);
    console.log("[siliconflow] res.headers:", res.headers);
    console.log("[siliconflow] res.status:", res.status);

    // to prevent browser prompt for credentials
    const newHeaders = new Headers(res.headers);
    newHeaders.delete("www-authenticate");
    // to disable nginx buffering
    newHeaders.set("X-Accel-Buffering", "no");

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    });
  } catch (error) {
    console.error("[SiliconFlow] request error", error);
  } finally {
    clearTimeout(timeoutId);
  }
}
