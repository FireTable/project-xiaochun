cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.2"
  sha256 arm:   "52141e530d448c93208fd881829cf8752180563ac46fac54dd494f039ea11dfc",
         intel: "87f5bf45175a12f1eb352b8df2821d782d149eb51fadfe774a9a1f35274c68b2"

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
