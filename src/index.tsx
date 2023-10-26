import { PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Link } from './components/link';
import { Title } from './components/title';
import { Text } from './components/text';
import { NotFound } from './components/not-found';
import { rm as deleteFile, writeFile } from 'fs/promises';
import { temporaryFile } from 'tempy';
import { getCommitHash } from './get-commit-hash';
import semver from 'semver';

const ButtonRow: React.FC<PropsWithChildren> = ({ children }) => <div className="flex flex-row gap-2">{children}</div>;

const TextArea: React.FC<{
  id: string;
  name: string;
  placeholder?: string;
  readOnly?: boolean;
  value?: string | number;
  rows?: number;
}> = ({ placeholder, id, name, value, readOnly = false, rows = 10 }) => (
  <textarea
    className="bg-[#1e1a2a] text-[#f8f8f2] p-2 rounded-md"
    name={name}
    id={id}
    placeholder={placeholder}
    readOnly={readOnly}
    value={value}
    rows={rows}
  ></textarea>
);

const Radio: React.FC<{ name: string; value: string | number; label: string; defaultChecked?: boolean }> = ({
  name,
  value,
  label,
  defaultChecked = false,
}) => {
  const id = name + '-' + value;
  return (
    <>
      <input
        defaultChecked={defaultChecked}
        className="bg-[#1e1a2a] text-[#f8f8f2] p-2 rounded-md"
        type="radio"
        id={id}
        name={name}
        value={value}
      />
      <label className="bg-[#1e1a2a] text-[#f8f8f2] p-2 rounded-md" htmlFor={id}>
        {label}
      </label>
    </>
  );
};

const Button: React.FC<PropsWithChildren> = ({ children }) => (
  <button className="bg-[#f8f8f2] text-[#1e1a2a] p-2 rounded-md" type="submit">
    {children}
  </button>
);

const UserInput: React.FC = () => {
  return (
    <>
      <form className="flex flex-col gap-2" hx-post="/minify" hx-target="#output">
        <TextArea name="input" id="input" placeholder="Enter your js here" />
        <ButtonRow>
          <Radio name="sourcemap" value="inline" label="Inline sourcemap" defaultChecked />
          <Radio name="sourcemap" value="external" label="External sourcemap" />
          <Radio name="sourcemap" value="none" label="No sourcemap" />
        </ButtonRow>
        <ButtonRow>
          <Radio name="splitting" value="yes" label="Split" />
          <Radio name="splitting" value="no" label="Don't split" defaultChecked />
        </ButtonRow>
        <Button>Minify</Button>
      </form>
      <div className="flex flex-col gap-2" id="output">
        <textarea
          className="bg-[#1e1a2a] text-[#f8f8f2] p-2 rounded-md"
          readOnly
          placeholder="Minified text will appear here"
          rows={10}
        />
      </div>
    </>
  );
};

const App: React.FC<PropsWithChildren> = ({ children }) => (
  <html lang="en">
    <head>
      <title>Minify</title>
      <meta name="description" content="Minify things" />
      <meta charSet="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="view-transition" content="same-origin" />
      <script src="https://cdn.tailwindcss.com" />
    </head>
    <body className="h-full w-full bg-[#0e0c15]">
      <header
        className="sm:w-4/6 w-5/6 container mx-auto mb-5"
        style={{
          viewTransitionName: 'main',
        }}
      >
        <Link href="/">
          <Title>Minify</Title>
        </Link>
      </header>

      <main className="sm:w-4/6 w-5/6 container mx-auto mb-5">{children}</main>

      <footer className="sm:w-4/6 w-5/6 container mx-auto mb-5">
        <Text>&copy; {new Date().getFullYear()} Minify. All rights reserved.</Text>
        <img
          style={{
            display: 'none',
          }}
          src="https://v.fish.lgbt/pixel.gif?id=minify.fish.lgbt"
        />
      </footer>
    </body>
    <script src="https://fish.lgbt/assets/js/htmx.org@1.9.4.min.js"></script>
  </html>
);

// Get the version of the current application
const version = await import(`${process.cwd()}/package.json`)
  .then((pkg) => semver.parse(pkg.version)?.major)
  .catch(() => 'unknown');
const releaseId = await import(`${process.cwd()}/package.json`)
  .then((pkg) => `${pkg.version}+${getCommitHash(process.cwd())}`)
  .catch(() => 'unknown');

const server = Bun.serve({
  port: process.env.PORT ?? 3000,
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/.well-known/health') {
      const fields = {
        version,
        releaseId,
        time: new Date().toISOString(),
      };
      return new Response(
        JSON.stringify({
          ...fields,
          status: 'pass',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/health+json',
          },
        },
      );
    }

    if (path === '/')
      return new Response(
        renderToStaticMarkup(
          <App>
            <UserInput />
          </App>,
        ),
        {
          headers: {
            'Content-Type': 'text/html',
          },
        },
      );

    if (path === '/minify') {
      const formData = await request.formData();
      const input = formData.get('input')?.toString() ?? '';
      const sourcemap = formData.get('sourcemap')?.toString() as 'inline' | 'external' | 'none' | undefined;
      const splitting = formData.get('splitting')?.toString() === 'on';
      const tempFilePath = temporaryFile({
        extension: 'tsx',
      });
      try {
        await writeFile(tempFilePath, input, 'utf-8');
        const build = await Bun.build({
          entrypoints: [tempFilePath],
          minify: {
            identifiers: true,
            syntax: true,
            whitespace: true,
          },
          external: ['*'],
          splitting,
          sourcemap: sourcemap && ['inline', 'external', 'none'].includes(sourcemap) ? sourcemap : 'inline',
        });

        // Build failed
        if (!build.success) {
          const outputs = await Promise.all(
            build.logs.map((log, index) => (
              <TextArea
                key={log.name + '-' + index}
                id={log.name + '-' + index}
                name={log.name + '-' + index}
                readOnly
                value={log.message}
              />
            )),
          );
          const output = renderToStaticMarkup(<>{outputs}</>);
          return new Response(output, {
            headers: {
              'Content-Type': 'text/html charset="UTF-8"',
            },
          });
        }

        // Build succeeded
        const outputs = await Promise.all(
          build.outputs.map(async (output) => ({
            kind: output.kind,
            path: output.path,
            sourcemap: await output.sourcemap?.text(),
            text: await output.text(),
          })),
        );
        const output = renderToStaticMarkup(
          <>
            {outputs.map((output, index) => (
              <TextArea
                key={output.kind + '-' + index}
                id={output.kind + '-' + index}
                name={output.kind + '-' + index}
                readOnly
                value={output.text}
              />
            ))}
          </>,
        );
        return new Response(output, {
          headers: {
            'Content-Type': 'text/html charset="UTF-8"',
          },
        });
      } catch (error) {
        return new Response(
          renderToStaticMarkup(
            <>
              <TextArea
                id="error"
                name="error"
                readOnly
                value={error instanceof Error ? error.message : 'Failed to minify'}
              />
            </>,
          ),
          {
            headers: {
              'Content-Type': 'text/html charset="UTF-8"',
            },
          },
        );
      } finally {
        await deleteFile(tempFilePath);
      }
    }

    return new Response(
      renderToStaticMarkup(
        <App>
          <NotFound />
        </App>,
      ),
      {
        headers: {
          'Content-Type': 'text/html',
        },
      },
    );
  },
});

console.info(`Server started at http://localhost:${server.port}`);
