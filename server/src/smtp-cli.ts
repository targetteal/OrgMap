import { startSmtpSink } from "./smtp.js";
const server = await startSmtpSink();
console.log(
  "OrgMap SMTP sink listening on 127.0.0.1:" +
    String((server.address() as any).port),
);
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => server.close(() => process.exit(0)));
