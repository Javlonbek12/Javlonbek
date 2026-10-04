"use client";

import { useEffect, useRef } from "react";

// Renders the official Telegram Login Widget. After login Telegram redirects
// the browser to `authUrl` with the signed user data.
// Works only on the domain set for the bot in @BotFather (/setdomain).
export function TelegramLoginButton({
  botUsername,
  authUrl,
}: {
  botUsername: string;
  authUrl: string;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-auth-url", authUrl);
    script.setAttribute("data-request-access", "write");
    node.replaceChildren(script);
    return () => node.replaceChildren();
  }, [botUsername, authUrl]);

  return <div ref={container} className="flex min-h-12 justify-center" />;
}
