import stat

import httpx
import pytest

from sparrow.clients.curl import CurlTransport


def fake_curl(tmp_path, output: str, code: int = 0, stderr: str = ""):
    """A stand-in `curl` that records its arguments, then prints `output`."""
    script = tmp_path / "curl"
    script.write_text(
        "#!/bin/sh\n"
        f'printf "%s\\n" "$@" > "{tmp_path}/argv"\n'
        f"printf '%s' '{output}'\n"
        f"printf '%s' '{stderr}' >&2\n"
        f"exit {code}\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    return str(script)


async def test_a_request_goes_through_curl_and_comes_back_as_a_response(tmp_path):
    curl = fake_curl(
        tmp_path, '[{"id": 4, "name": "Movies"}]\n--sparrow-curl--200 application/json'
    )
    client = httpx.AsyncClient(transport=CurlTransport(binary=curl, timeout=5))
    response = await client.get("http://192.168.50.6:8484/api/libraries", headers={"x-a": "1"})
    assert response.status_code == 200 and response.json() == [{"id": 4, "name": "Movies"}]
    assert response.headers["content-type"] == "application/json"
    argv = (tmp_path / "argv").read_text().splitlines()
    assert argv[-1] == "http://192.168.50.6:8484/api/libraries" and "--compressed" in argv
    assert "x-a: 1" in argv and not any(a.lower().startswith("accept-encoding") for a in argv)


async def test_an_unreachable_host_is_a_connect_error(tmp_path):
    curl = fake_curl(tmp_path, "\n--sparrow-curl--000 ", code=7, stderr="Failed to connect")
    with pytest.raises(httpx.ConnectError, match="Failed to connect"):
        await httpx.AsyncClient(transport=CurlTransport(binary=curl)).get(
            "http://192.168.50.6:8484/"
        )
