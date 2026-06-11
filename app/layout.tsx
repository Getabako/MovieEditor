import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MovieEditor — 口頭指示で動画編集",
  description: "既存動画を読み込み、口頭/自然言語の指示で非破壊編集する Codex + Remotion ツール",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
