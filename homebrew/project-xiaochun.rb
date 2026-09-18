cask "project-xiaochun" do
  arch arm: "aarch64", intel: "e6df024bc51c4fea1763e853fa3f9671eaac60031c185578f9a0b14b6413834e"

  version "0.1.0-preview.9"
  sha256 arm:   "bb972f42b6b327d4fe5ed4aff03354c546331db81d4852319d0c556e6bfae159",
         intel: "e6df024bc51c4fea1763e853fa3f9671eaac60031c185578f9a0b14b6413834e"

  url "https://github.com/FireTable/project-xiaochun/releases/download/v#{version}/Project_XiaoChun_#{version}_#{arch}.dmg"
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
