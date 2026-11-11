import { sesionSuperadmin } from "../_lib/superadmin.mjs";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  return sesionSuperadmin(req, res);
}
