import { logoutSuperadmin } from "../_lib/superadmin.mjs";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  return logoutSuperadmin(req, res);
}
