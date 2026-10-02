#!/usr/bin/env bash
# リリースのビルドの入口の確認(cloudbuild.yaml の最初のステップ verify-source。doc/07_インフラ・運用.md 4章、doc/06_セキュリティ設計.md 12章)。
#
# トリガーからのビルド(TRIGGER_NAME がある)では、次をすべて満たさなければ失敗する(ビルド・push・マイグレーションの前に止める):
#   - TAG_NAME が vX.Y.Z の形(タグの push 以外の起動、例えば `gcloud builds triggers run --branch=…` では出さない)
#   - GitHub 上のタグ TAG_NAME が、いまビルドしているコミット COMMIT_SHA を指している(注釈つきタグは指す先のコミット)
#   - COMMIT_SHA が GitHub 上の main(RELEASE_BRANCH)に含まれている(ブランチの途中のコミットに付けたタグを出さない)
# このビルドのワークスペース(.git の有無・浅さはトリガーの種類で変わる)は使わず、GitHub から直接読む。非公開のリポジトリを読む
# トークンは、第 2 世代の接続のリポジトリ SOURCE_REPOSITORY の accessReadToken で得る(ビルドの SA に
# roles/cloudbuild.readTokenAccessor が要る。infra/gcp の var.cloudbuild_github_connection)。トリガーからのビルドでは
# ALLOW_UNVERIFIED_SOURCE は見ない(トリガーの置換で確認を外せないようにする)。
#
# 手元からの `gcloud builds submit`(TRIGGER_NAME が空。COMMIT_SHA・TAG_NAME も空)は確かめようがないため、
# ALLOW_UNVERIFIED_SOURCE=true(--substitutions=_ALLOW_UNVERIFIED_SOURCE=true)を明示したときだけ通す。手元から出せるのは
# katahimo-deployer に成り代われる運用担当者だけなので、この指定で権限は広がらない(初回の構築 doc/07 3.5 と、緊急時)。
#
# 限界: この確認はビルドするコミットの cloudbuild.yaml とこのファイルにあるため、そのコミットを書ける人は外せる。止められるのは
# 誤って・見直されずに付いたタグ(release-tag.yml を通らない `git push origin vX.Y.Z` 等)まで。本当の守りは、タグを作れる人を
# 絞る GitHub のルールセットと、Cloud Build のトリガーの承認(doc/07 4.1)。
#
# 入力(環境変数): TRIGGER_NAME・TAG_NAME・COMMIT_SHA・ALLOW_UNVERIFIED_SOURCE・SOURCE_GIT_URL(必須)・SOURCE_REPOSITORY
# (空ならトークンを使わない。テスト用)・RELEASE_BRANCH(既定 main)
set -euo pipefail

fail() {
  echo "verify-source: $1" >&2
  exit 1
}

TRIGGER_NAME="${TRIGGER_NAME:-}"
TAG_NAME="${TAG_NAME:-}"
COMMIT_SHA="${COMMIT_SHA:-}"
ALLOW_UNVERIFIED_SOURCE="${ALLOW_UNVERIFIED_SOURCE:-false}"
SOURCE_REPOSITORY="${SOURCE_REPOSITORY:-}"
RELEASE_BRANCH="${RELEASE_BRANCH:-main}"
[ -n "${SOURCE_GIT_URL:-}" ] || fail "SOURCE_GIT_URL が空です"

if [ -z "$TRIGGER_NAME" ]; then
  if [ "$ALLOW_UNVERIFIED_SOURCE" = true ]; then
    echo "verify-source: 手元からの実行(_ALLOW_UNVERIFIED_SOURCE=true)。ソースが main のタグかは確かめません"
    exit 0
  fi
  fail "トリガーからではないビルドです。手元から出すなら --substitutions に _ALLOW_UNVERIFIED_SOURCE=true を付ける(運用担当者だけ。doc/07 3.5・4章)"
fi

if [ "$ALLOW_UNVERIFIED_SOURCE" = true ]; then
  echo "verify-source: トリガーからのビルドでは _ALLOW_UNVERIFIED_SOURCE を無視して確かめます"
fi
[[ "$TAG_NAME" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || fail "トリガー ${TRIGGER_NAME} の起動が vX.Y.Z のタグではありません(TAG_NAME='${TAG_NAME}')"
[[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "COMMIT_SHA が40桁の SHA ではありません: '${COMMIT_SHA}'"

needed="git"
[ -z "$SOURCE_REPOSITORY" ] || needed="git curl python3 gcloud base64"
for cmd in $needed; do
  command -v "$cmd" >/dev/null || fail "${cmd} がありません(ステップのイメージを確かめる)"
done

export GIT_TERMINAL_PROMPT=0
if [ -n "$SOURCE_REPOSITORY" ]; then
  access_token="$(gcloud auth print-access-token)"
  response="$(curl -fsS -X POST -H "Authorization: Bearer ${access_token}" -H 'Content-Type: application/json' -d '{}' \
    "https://cloudbuild.googleapis.com/v2/${SOURCE_REPOSITORY}:accessReadToken")" \
    || fail "リポジトリを読むトークンを得られません(ビルドの SA に roles/cloudbuild.readTokenAccessor が要る。doc/07 4.1)"
  read_token="$(printf '%s' "$response" | python3 -c 'import json, sys; print(json.load(sys.stdin)["token"])')" \
    || fail "accessReadToken の応答に token がありません"
  # トークンはコマンドの引数・URL に載せずヘッダーで渡す(actions/checkout と同じ形)
  basic="$(printf 'x-access-token:%s' "$read_token" | base64 | tr -d '\n')"
  export GIT_CONFIG_COUNT=1
  export GIT_CONFIG_KEY_0="http.https://github.com/.extraheader"
  export GIT_CONFIG_VALUE_0="Authorization: basic ${basic}"
fi

# タグが指すコミット(注釈つきタグは ^{} の行が指す先のコミット)
refs="$(git ls-remote "$SOURCE_GIT_URL" "refs/tags/${TAG_NAME}" "refs/tags/${TAG_NAME}^{}")" \
  || fail "${SOURCE_GIT_URL} のタグを読めません"
tag_commit="$(awk -v r="refs/tags/${TAG_NAME}^{}" '$2 == r { print $1 }' <<<"$refs")"
[ -n "$tag_commit" ] || tag_commit="$(awk -v r="refs/tags/${TAG_NAME}" '$2 == r { print $1 }' <<<"$refs")"
[ -n "$tag_commit" ] || fail "GitHub にタグ ${TAG_NAME} がありません"
[ "$tag_commit" = "$COMMIT_SHA" ] \
  || fail "タグ ${TAG_NAME} は ${tag_commit} を指しており、ビルドしている ${COMMIT_SHA} ではありません"

# main の履歴(コミットだけ。ツリー・ファイルは取らない)に含まれるか
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git clone --quiet --bare --no-tags --single-branch --branch "$RELEASE_BRANCH" --filter=tree:0 "$SOURCE_GIT_URL" "$work/repo" \
  || fail "${SOURCE_GIT_URL} の ${RELEASE_BRANCH} を読めません"
# merge-base は手元に無いコミットを取りに行くことがある(部分クローン)ため、main から辿れるコミットの一覧で確かめる
git -C "$work/repo" rev-list "refs/heads/${RELEASE_BRANCH}" >"$work/commits"
grep -qxF "$COMMIT_SHA" "$work/commits" || fail "${COMMIT_SHA} は ${RELEASE_BRANCH} に含まれていません"

echo "verify-source: ${TAG_NAME} = ${COMMIT_SHA:0:7}(${RELEASE_BRANCH} に含まれる)"
