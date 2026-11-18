import { deliverAccountMail } from "./account-mail.js";
import { pool } from "./db.js";
try {
  console.log({ delivered: await deliverAccountMail() });
} finally {
  await pool.end();
}
