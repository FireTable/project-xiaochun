cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.29"
  sha256 arm:   "62c11e9e8b761d45e2935a0c42473160ff3b60065a9bbbc3e496faf7ca8a8ea0",
         intel: "dc717f35c44e38937dfc7852758aa6021582959f2b4f0c965162eaa086b3fd59"

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
