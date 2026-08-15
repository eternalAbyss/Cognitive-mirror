import { GRAPH_CORE, getJson } from "../../../lib/services";

export const dynamic = "force-dynamic";

interface ApprovalView {
  id: string;
  ts: string;
  action: "merge" | "delete";
  title: string;
  detail: string;
  subjectIds: string[];
}

/** Pending cleanup approvals the maintenance engine is waiting on (design §9). */
export async function GET() {
  const data = await getJson<{ approvals: ApprovalView[] }>(`${GRAPH_CORE}/approvals`, {
    approvals: [],
  });
  return Response.json(data);
}
