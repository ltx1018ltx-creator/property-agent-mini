import http.client
import os
from pathlib import Path
import re
import shlex
import socket
import subprocess
import time
import unittest
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]


def render_start_command():
    """Read the command from the web-service definition Render deploys."""
    manifest = (ROOT / 'render.yaml').read_text()
    service = re.search(
        r'(?ms)^  - type: web\n    name: mari-property\n'
        r'.*?^    startCommand: ([^\n]+)$',
        manifest,
    )
    if not service:
        raise AssertionError('Render web service startCommand is missing')
    return shlex.split(service.group(1).strip())


class RenderEntrypointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            cls.port = listener.getsockname()[1]
        environment = {**os.environ, 'PORT': str(cls.port)}
        cls.process = subprocess.Popen(
            render_start_command(),
            cwd=ROOT,
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if cls.process.poll() is not None:
                error = cls.process.stderr.read().decode(errors='replace')
                raise RuntimeError(f'Render server exited during startup: {error}')
            try:
                with socket.create_connection(('127.0.0.1', cls.port), timeout=.2):
                    break
            except OSError:
                time.sleep(.05)
        else:
            cls.process.terminate()
            raise RuntimeError('Render server did not start')

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait(timeout=5)
        cls.process.stderr.close()

    def request(self, path):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        connection.request('GET', path)
        response = connection.getresponse()
        result = response.status, response.getheader('Content-Type'), response.read()
        connection.close()
        return result

    def test_landing_files_are_served_by_render_entrypoint(self):
        cases = (
            ('/landing.html?agent=test', 'text/html'),
            ('/landing.js', 'text/javascript'),
            ('/landing.css', 'text/css'),
        )
        for path, expected_type in cases:
            with self.subTest(path=path):
                status, content_type, body = self.request(path)
                self.assertEqual(status, 200)
                self.assertTrue(content_type.startswith(expected_type), content_type)
                self.assertTrue(body)

    def test_unknown_private_and_traversal_paths_are_not_served(self):
        paths = (
            '/unknown',
            '/server.py',
            '/README.md',
            '/.git/config',
            '/tests/test_render_entrypoint.py',
            '/../server.py',
            '/%2e%2e/server.py',
            '/icons/%2e%2e/server.py',
        )
        for path in paths:
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)

    def test_landing_local_assets_exist_with_exact_case_and_are_tracked(self):
        html = (ROOT / 'landing.html').read_text()
        css = (ROOT / 'landing.css').read_text()
        references = re.findall(r'(?:src|href)=["\']([^"\']+)', html)
        references += re.findall(r'url\(["\']?([^"\')]+)', css)
        local = {
            urlsplit(reference).path
            for reference in references
            if not urlsplit(reference).scheme
            and not reference.startswith(('#', '//'))
        }
        tracked = set(subprocess.check_output(
            ['git', 'ls-files'], cwd=ROOT, text=True
        ).splitlines())
        for relative in ('landing.html', 'landing.js', 'landing.css', *sorted(local)):
            with self.subTest(relative=relative):
                path = ROOT / relative
                self.assertTrue(path.is_file(), relative)
                self.assertIn(relative, tracked)
                actual_name = next(
                    child.name for child in path.parent.iterdir()
                    if child.name.casefold() == path.name.casefold()
                )
                self.assertEqual(actual_name, path.name)


if __name__ == '__main__':
    unittest.main()
