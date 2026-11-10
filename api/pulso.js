import { recibirPulso } from "./_lib/http.mjs";

export default function handler(req, res) {
  return recibirPulso(req, res);
}
