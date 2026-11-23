"use client";

import { ArrowRight, Mail } from "lucide-react";
import { useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { requestLoginLink, startGoogleLogin, type GoogleLoginState, type LoginState } from "./actions";

const messages = {
  idle: "",
  invalid: "올바른 이메일 주소를 입력해 주세요.",
  sent: "등록된 이메일이라면 로그인 링크가 도착해요. 받은편지함과 스팸함을 확인해 주세요.",
  limited: "요청이 너무 많아요. 잠시 기다린 뒤 다시 시도해 주세요.",
  error: "지금은 로그인 링크를 보낼 수 없어요. 잠시 후 다시 시도해 주세요.",
  unconfigured: "로그인 설정이 필요해요.",
};

function GoogleLoginForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState<GoogleLoginState>(startGoogleLogin, "idle");

  return (
    <form className="login-form" action={action} aria-busy={pending}>
      <button className="primary-button" disabled={pending || !configured} type="submit">
        {pending ? "Google에 연결하는 중…" : "Google로 계속하기"}
        {!pending && <ArrowRight aria-hidden="true" size={17} />}
      </button>
      {pending && <p className="sr-only" role="status">Google에 연결하는 중</p>}
      {!pending && state !== "idle" && (
        <p className="notice notice-error" role="alert">
          {state === "unavailable"
            ? "Google 로그인이 아직 준비되지 않았어요. 이메일 로그인 링크를 이용해 주세요."
            : "Google에 연결할 수 없어요. 다시 시도하거나 이메일 로그인 링크를 이용해 주세요."}
        </p>
      )}
    </form>
  );
}

export function LoginForm({ configured }: { configured: boolean }) {
  return (
    <>
      <GoogleLoginForm configured={configured} />
      <EmailLoginForm configured={configured} />
    </>
  );
}

function EmailLoginForm({ configured }: { configured: boolean }) {
  const [email, setEmail] = useState("");
  const [state, action, pending] = useActionState<LoginState, FormData>(requestLoginLink, { status: "idle" });
  const failed = state.status !== "idle" && state.status !== "sent";
  const buttonLabel = pending ? "보내는 중…" : state.status === "sent" ? "로그인 링크 다시 받기" : "로그인 링크 받기";

  return (
    <form className="login-form login-form-email" aria-labelledby="login-email-heading" action={action}>
      <h2 id="login-email-heading">이메일로 로그인</h2>
      <div className="form-field">
        <label htmlFor="email">이메일 주소</label>
        <div className="email-input">
          <Mail size={17} strokeWidth={1.7} aria-hidden="true" />
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="name@example.com"
            className="pl-10"
            maxLength={254}
            required
            readOnly={pending}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={state.status === "invalid" || undefined}
            aria-describedby={state.status === "invalid" ? "login-feedback" : undefined}
          />
        </div>
      </div>
      <button className="quiet-link" disabled={pending || !configured} type="submit">
        {buttonLabel}
        {!pending && <ArrowRight aria-hidden="true" size={17} />}
      </button>
      {!configured && (
        <p className="notice" role="status">
          <strong>로그인 설정이 필요해요.</strong>
          <span>로컬 환경에서 Supabase 인증 설정을 마친 뒤 다시 열어 주세요.</span>
        </p>
      )}
      {pending && <p className="sr-only" role="status">이메일 전송 중</p>}
      {state.status !== "idle" && !pending && (
        <p id="login-feedback" className={failed ? "notice notice-error" : "notice notice-success"} role={failed ? "alert" : "status"}>
          {messages[state.status]}
        </p>
      )}
    </form>
  );
}
