cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.2"
  sha256 arm:   "d822fcf80fa89542f2d871629bc3f1388ff3e356364268ee10d174cb72b66b5b",
         intel: "49cce4ffe6e5f33a1cd05057726baf1e83eaf0aecfc8f2be3f16777d0da36eb6"

  url "https://github.com/FireTable/project-xiaochun/releases/download/v#{version}/Project.XiaoChun_#{version}_#{arch}.dmg"
  name "Project XiaoChun"
  desc "100% Client-Native Anime Companion & Transparent Desktop Pet"
  homepage "https://github.com/FireTable/project-xiaochun"

  app "Project XiaoChun.app"

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-cr", "#{appdir}/Project XiaoChun.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/tech.firetable.xiaochun",
    "~/Library/Preferences/tech.firetable.xiaochun.plist",
    "~/Library/Saved Application State/tech.firetable.xiaochun.savedState",
  ]
end
