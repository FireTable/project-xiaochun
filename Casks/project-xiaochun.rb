cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.4"
  sha256 arm:   "9881980ca27f9da37dcb58bfd73fefe08d6d4bbef5a70b160c36a966aee04dcb",
         intel: "001b3e1c9baaf926fec3526b9be95b0bf954960d6d602b7bbfaad0acf3ec7433"

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
