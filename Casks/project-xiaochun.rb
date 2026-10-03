cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.14"
  sha256 arm:   "e2fb16bb8878192d0c0283cabb19bc762136070daf8827c91a640314347cef81",
         intel: "214d8e9426c8a117d4418c429fec58cafcc2cbbec790232b582520fae6a16863"

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
