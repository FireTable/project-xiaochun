cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.39"
  sha256 arm:   "8326ebf9734fe30d82acf4ef22dc26dc2698352c24ab54098ee906d5617bf33e",
         intel: "3328cf17f5bdb679087b9bdf297d9fb0340dd959ec7a775748c084447c2b4554"

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
