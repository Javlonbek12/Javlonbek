import type { NextRequest } from "next/server";

import { sessionProxy } from "@/modules/core/auth/proxy";

// Signed out → sign-in with the way back (?next=); a long session → a renewed cookie.
export function proxy(request: NextRequest) {
  return sessionProxy(request);
}

export const config = {
  // Every page except sign-in, invitations, public share links (/p), the offline page, API
  // routes, Next's own files and static files (anything with a dot: sw.js, icons, the manifest).
  matcher: ["/((?!api/|_next/|login|invite/|p/|offline|.*\\..*).*)"],
};
