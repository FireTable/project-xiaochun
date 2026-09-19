cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.4"
  sha256 arm:   "4d9755603629f0853a0db1ec51d67024dd131c9d2729f7b8624132f6130db02d",
         intel: "d29dcb03bc8c9bb1ac6fb28ae015a5b5a05f9fcc827c4bbbdf05b7ec77c04edf"

  url "https://github.com/FireTable/project-xiaochun/releases/download/v#{version}/Project.XiaoChun_#{version}_#{arch}.dmg"
  name "Project XiaoChun"
  desc "100% Client-Native Anime Companion & Transparent Desktop Pet"
  homepage "https://github.com/FireTable/project-xiaochun"

  depends_on :macos

  app "Project XiaoChun.app"

  postflight_steps do
    run "/usr/bin/xattr", args: ["-cr", "/Applications/Project XiaoChun.app"]
  end

  zap trash: [
    "~/Library/Application Support/tech.firetable.xiaochun",
    "~/Library/Preferences/tech.firetable.xiaochun.plist",
    "~/Library/Saved Application State/tech.firetable.xiaochun.savedState",
  ]
end
