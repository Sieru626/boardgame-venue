import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 3010 単一ポート運用時、サーバー組み込み Next のロックが他と被らないよう別ディレクトリにする（3000 は成立たせ屋本舗で使用）
  distDir: ".next-venue",
};

export default nextConfig;
