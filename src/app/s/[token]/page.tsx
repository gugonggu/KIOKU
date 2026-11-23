import { SharedPage } from "./shared-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "공유 받은 여행" };

export default async function Page({ params }: PageProps<"/s/[token]">) {
  const { token } = await params;
  return <SharedPage token={token} />;
}
