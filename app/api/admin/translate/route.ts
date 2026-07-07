import { NextRequest, NextResponse } from "next/server";
import { adminRequestHasPermissionAsync } from "@/lib/admin-auth";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { translateProductContent } from "@/lib/translate";

export async function POST(request: NextRequest) {
  if (!(await adminRequestHasPermissionAsync(request, "ai:write"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isFeatureEnabled("ai_tools"))) return featureDisabledResponse("ai_tools");

  const payload = (await request.json()) as {
    name_cn?: unknown;
    description_cn?: unknown;
  };

  const nameCn = typeof payload.name_cn === "string" ? payload.name_cn.trim() : "";
  const descriptionCn = typeof payload.description_cn === "string" ? payload.description_cn.trim() : "";

  if (!nameCn && !descriptionCn) {
    return NextResponse.json(
      { error: "请先填写中文名称或中文描述。" },
      { status: 400 },
    );
  }

  const result = await translateProductContent({
    name_cn: nameCn,
    description_cn: descriptionCn,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: 502 },
    );
  }

  return NextResponse.json(result.translations);
}
