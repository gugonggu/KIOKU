import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { Cover } from "@/components/cover";
import { getVerifiedUserId } from "@/lib/auth";
import { getAuthConfig } from "@/lib/auth-config";
import { LoginForm } from "./login-form";

export const metadata = { title: "로그인" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { notice } = await searchParams;
  if (await getVerifiedUserId()) redirect("/trips");

  return (
    <div className="safe-page login-page">
      <header className="login-header"><Brand /></header>
      <main id="main-content" className="login-grid" tabIndex={-1}>
        <Cover />
        <section className="login-content" aria-labelledby="login-heading">
          <div className="login-inner">
            <h1 id="login-heading">로그인</h1>
            <p className="intro">내 일본 여행 수첩을 열어 보세요.</p>
            {(notice === "google" || notice === "google-account") && (
              <p className="notice notice-error" role="alert">
                <strong>Google 로그인을 완료할 수 없어요.</strong>
                <span>{notice === "google-account"
                  ? "등록한 이메일과 같은 Google 계정을 선택하거나 이메일 로그인 링크를 이용해 주세요."
                  : "다시 시도하거나 이메일 로그인 링크를 이용해 주세요."}</span>
              </p>
            )}
            {notice === "link" && (
              <p className="notice notice-error" role="alert">
                <strong>로그인 링크를 사용할 수 없어요.</strong>
                <span>새 로그인 링크를 요청해 주세요. 링크를 요청한 브라우저에서 가장 최근 메일의 링크를 열어 주세요.</span>
              </p>
            )}
            <LoginForm configured={Boolean(getAuthConfig())} />
          </div>
        </section>
      </main>
    </div>
  );
}
