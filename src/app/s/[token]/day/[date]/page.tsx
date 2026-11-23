import { SharedPage } from "../../shared-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "공유 받은 일정" };

export default async function Page({ params }: PageProps<"/s/[token]/day/[date]">) {
  const { token, date } = await params;
  return <SharedPage token={token} day={date} />;
}
