import { panelVersiones } from "../_lib/versiones.mjs";
import { requiereSuperadmin } from "../_lib/superadmin.mjs";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, private");
  if (!requiereSuperadmin(req, res)) return;
  return panelVersiones(req, res);
}
