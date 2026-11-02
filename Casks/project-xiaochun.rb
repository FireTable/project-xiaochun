cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.3"
  sha256 arm:   "c65be14027d505a145dd31a5ffae5b5c38b18f82e0816b0d70f2f54a9d300239",
         intel: "db86f26d754cc8f07c2ac4bd411b5dc076975cffa83dc7c9aaaa509aa9a06fb5"

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
