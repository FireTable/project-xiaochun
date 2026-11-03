cask "project-xiaochun" do
  arch arm: "aarch64", intel: "x64"

  version "0.2.7"
  sha256 arm:   "f37d7d63a6fac44352c835e865d633001a2dfbf0b6d589a3fac410c379b94399",
         intel: "1975ca76682b0547f308f733b54647b36fab18a963d9ef3aeed3fba01fd2fa24"

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
