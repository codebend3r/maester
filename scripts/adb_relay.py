"""Relays a loopback port to a TV's adb.

macOS Local Network privacy keeps the Android SDK's adb off the LAN while Apple's
/usr/bin/python3 reaches it, so the deploy script points adb at 127.0.0.1 and this
pipes each connection on to the TV. Each accepted connection opens one to the TV,
and the two are piped both ways until either side closes.

    /usr/bin/python3 -I scripts/adb_relay.py <tv host> <tv port> <listen port>
"""

import socket
import sys
import threading


def pipe(source: socket.socket, sink: socket.socket) -> None:
    """Copies everything the source sends to the sink, and closes both at the end."""
    try:
        while data := source.recv(65536):
            sink.sendall(data)
    except OSError:
        pass
    finally:
        for sock in (source, sink):
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def serve(host: str, port: int, listen: int) -> None:
    """Accepts connections on the loopback port forever, each relayed to the TV."""
    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", listen))
    server.listen(8)
    while True:
        client, _ = server.accept()
        try:
            upstream = socket.create_connection((host, port), 10)
        except OSError:
            client.close()
            continue
        upstream.settimeout(None)
        for source, sink in ((client, upstream), (upstream, client)):
            threading.Thread(target=pipe, args=(source, sink), daemon=True).start()


if __name__ == "__main__":
    serve(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]))
