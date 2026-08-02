import os
import posixpath
import sys
import time

import paramiko


HOST = os.environ.get("VPS_HOST", "72.60.29.145")
USER = os.environ.get("VPS_USER", "root")
PASSWORD = os.environ.get("VPS_PASSWORD")
REMOTE_ROOT = os.environ.get("VPS_APP_DIR", "/opt/onion-web-flows-backend")
APP_NAME = os.environ.get("PM2_APP", "onion-web-flows-backend")


def fail(message):
    print(f"[FAIL] {message}", file=sys.stderr)
    sys.exit(1)


if not PASSWORD:
    fail("VPS_PASSWORD nao definido")


def connect():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=20)
    return client


def run(client, command, check=True):
    stdin, stdout, stderr = client.exec_command(command)
    code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    if check and code != 0:
        fail(f"Comando falhou ({code}): {command}\nSTDOUT:\n{out}\nSTDERR:\n{err}")
    return code, out, err


def read_remote(sftp, path):
    with sftp.open(path, "r") as handle:
        return handle.read().decode("utf-8")


def write_remote(sftp, path, content):
    with sftp.open(path, "w") as handle:
        handle.write(content.encode("utf-8"))


def backup_remote(client, path, stamp):
    backup = f"{path}.bak-loadtest-{stamp}"
    run(client, f"cp {shell_quote(path)} {shell_quote(backup)}")
    print(f"[BACKUP] {backup}")


def shell_quote(value):
    return "'" + value.replace("'", "'\"'\"'") + "'"


def patch_routes_index(content):
    export_line = "export { default as loadTestRouter } from './loadTest.js';"
    if export_line in content:
        return content, False
    if not content.endswith("\n"):
        content += "\n"
    return content + export_line + "\n", True


def patch_index(content):
    changed = False
    import_line = "import { loadTestRouter } from './src/routes/index.js';"
    if import_line not in content:
        marker = "import { reportsRouter } from './src/routes/index.js';"
        if marker not in content:
            fail("Nao encontrei import de reportsRouter para inserir loadTestRouter")
        content = content.replace(marker, marker + "\n" + import_line, 1)
        changed = True

    old_skip = "skip: (req) => req.path === '/whatsapp/webhook',"
    new_skip = "skip: (req) => req.path === '/whatsapp/webhook' || req.path.startsWith('/load-test'),"
    if new_skip not in content:
        if old_skip not in content:
            fail("Nao encontrei regra skip do apiLimiter para adicionar /load-test")
        content = content.replace(old_skip, new_skip, 1)
        changed = True

    mount_line = "app.use('/api/load-test', loadTestRouter);"
    if mount_line not in content:
        marker = "app.use('/api/reports', reportsRouter);"
        if marker not in content:
            fail("Nao encontrei mount de reportsRouter para inserir loadTestRouter")
        content = content.replace(marker, marker + "\n" + mount_line, 1)
        changed = True

    return content, changed


def main():
    local_route = os.path.abspath(os.path.join(os.getcwd(), "src", "routes", "loadTest.js"))
    if not os.path.exists(local_route):
        fail(f"Arquivo local nao encontrado: {local_route}")

    client = connect()
    sftp = client.open_sftp()
    stamp = time.strftime("%Y%m%d%H%M%S")

    try:
        run(client, f"test -d {shell_quote(REMOTE_ROOT)}")
        remote_route = posixpath.join(REMOTE_ROOT, "src/routes/loadTest.js")
        remote_routes_index = posixpath.join(REMOTE_ROOT, "src/routes/index.js")
        remote_index = posixpath.join(REMOTE_ROOT, "index.js")

        backup_remote(client, remote_routes_index, stamp)
        backup_remote(client, remote_index, stamp)
        run(client, f"mkdir -p {shell_quote(posixpath.dirname(remote_route))}")

        print(f"[UPLOAD] {remote_route}")
        sftp.put(local_route, remote_route)

        routes_index = read_remote(sftp, remote_routes_index)
        routes_index, changed_routes = patch_routes_index(routes_index)
        if changed_routes:
            write_remote(sftp, remote_routes_index, routes_index)
            print("[PATCH] src/routes/index.js")
        else:
            print("[SKIP] src/routes/index.js ja tinha export")

        index = read_remote(sftp, remote_index)
        index, changed_index = patch_index(index)
        if changed_index:
            write_remote(sftp, remote_index, index)
            print("[PATCH] index.js")
        else:
            print("[SKIP] index.js ja estava pronto")

        run(client, f"cd {shell_quote(REMOTE_ROOT)} && node --check index.js")
        run(client, f"cd {shell_quote(REMOTE_ROOT)} && node --check src/routes/loadTest.js")
        run(client, f"pm2 restart {shell_quote(APP_NAME)} --update-env")
        code, out, err = run(client, f"pm2 status {shell_quote(APP_NAME)} --no-color", check=False)
        print(out or err)
        print("[OK] Rota de load-test aplicada no VPS")
    finally:
        sftp.close()
        client.close()


if __name__ == "__main__":
    main()
