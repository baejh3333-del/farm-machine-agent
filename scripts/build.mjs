import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve, relative, isAbsolute } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const relativeDist = relative(resolve(root), resolve(dist));
if (!relativeDist || relativeDist.startsWith("..") || isAbsolute(relativeDist)) {
  throw new Error("빌드 대상 경로가 작업 폴더 밖입니다.");
}
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(root, "index.html"), join(dist, "index.html"));
await cp(join(root, "src"), join(dist, "src"), { recursive: true });
console.log("dist/ 생성 완료");
