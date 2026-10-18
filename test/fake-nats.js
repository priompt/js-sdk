// A minimal in-process NATS broker, enough of the text protocol for the
// client's subscribe(): INFO, CONNECT (with token auth), PING/PONG, SUB and MSG.
const net = require("net");

function startFakeNats({ token } = {}) {
  const subs = []; // { sock, subject, sid }
  const sockets = new Set();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => {});
    const info = { server_id: "fake", version: "2.10.0", proto: 1, max_payload: 1048576, headers: true, auth_required: Boolean(token) };
    sock.write(`INFO ${JSON.stringify(info)}\r\n`);
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const [op, ...args] = line.split(" ");
        switch (op.toUpperCase()) {
          case "CONNECT": {
            const opts = JSON.parse(args.join(" "));
            if (token && opts.auth_token !== token) {
              sock.end("-ERR 'Authorization Violation'\r\n");
              return;
            }
            break;
          }
          case "PING":
            sock.write("PONG\r\n");
            break;
          case "SUB":
            subs.push({ sock, subject: args[0], sid: args[args.length - 1] });
            break;
        }
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `nats://127.0.0.1:${port}`,
        publish(subject, body) {
          const n = Buffer.byteLength(body);
          for (const s of subs) if (s.subject === subject) s.sock.write(`MSG ${subject} ${s.sid} ${n}\r\n${body}\r\n`);
        },
        close() {
          for (const s of sockets) s.destroy();
          return new Promise((r) => server.close(r));
        },
      });
    })
  );
}

module.exports = { startFakeNats };
