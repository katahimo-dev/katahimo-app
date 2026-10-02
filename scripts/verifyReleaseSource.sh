#!/usr/bin/env bash
# リリースのビルドの入口の確認(cloudbuild.yaml の最初のステップ verify-source。doc/07_インフラ・運用.md 4章、doc/06_セキュリティ設計.md 12章)。
#
# トリガーからのビルド(TRIGGER_NAME がある)では、次をすべて満たさなければ失敗する(ビルド・push・マイグレーションの前に止める):
#   - TAG_NAME が vX.Y.Z の形(タグの push 以外の起動、例えば `gcloud builds triggers run --branch=…` では出さない)
#   - 読む先 SOURCE_GIT_URL が、トリガーのリポジトリ(組み込みの置換 REPO_FULL_NAME)の https://github.com/<owner>/<repo>.git。
#     トリガーの置換 _SOURCE_GIT_URL を別のリポジトリ(偽のタグを付けたフォーク等)に向けて確認をすり抜けられないようにする。
#     トークンを出す SOURCE_REPOSITORY も空・形の違うものは断る
#   - このビルド(BUILD_ID)の承認が APPROVED(トリガーの承認が外されていたら止める。doc/07 4.1 の 4)
#   - GitHub 上のタグ TAG_NAME が、いまビルドしているコミット COMMIT_SHA を指している。注釈つきタグで Cloud Build の COMMIT_SHA が
#     指す先のコミット(^{} の行)とタグのオブジェクトのどちらになるかは確かめられていないため、どちらと一致しても通し、どちらと一致したかを
#     ログに出す
#   - タグが指す先のコミット(注釈つきタグなら ^{} の行。タグのオブジェクトではない)が GitHub 上の main(RELEASE_BRANCH)に含まれている
#     (ブランチの途中のコミットに付けたタグを出さない)
# このビルドのワークスペース(.git の有無・浅さはトリガーの種類で変わる)は使わず、GitHub から直接読む。非公開のリポジトリを読む
# トークンは、第 2 世代の接続のリポジトリ SOURCE_REPOSITORY の accessReadToken で得る(ビルドの SA に
# roles/cloudbuild.readTokenAccessor が要る。infra/gcp の var.cloudbuild_github_connection)。承認の状態を読むには
# roles/cloudbuild.builds.viewer が要る(infra/gcp/iam.tf の deployer)。トリガーからのビルドでは ALLOW_UNVERIFIED_SOURCE は見ない
# (トリガーの置換で確認を外せないようにする)。
#
# 手元からの `gcloud builds submit`(TRIGGER_NAME が空。COMMIT_SHA・TAG_NAME も空)は確かめようがないため、
# ALLOW_UNVERIFIED_SOURCE=true(--substitutions=_ALLOW_UNVERIFIED_SOURCE=true)を明示したときだけ通す(承認の確認もしない)。
# 手元から出せるのは katahimo-deployer に成り代われる運用担当者だけなので、この指定で権限は広がらない(初回の構築 doc/07 3.5 と、緊急時)。
#
# 限界: この確認はビルドするコミットの cloudbuild.yaml とこのファイルにあるため、そのコミットを書ける人は外せる。止められるのは
# 誤って・見直されずに付いたタグ(release-tag.yml を通らない `git push origin vX.Y.Z` 等)と、承認が外れたトリガーまで。本当の守りは、
# タグを作れる人を絞る GitHub のルールセットと、Cloud Build のトリガーの承認(doc/07 4.1)。
#
# 入力(環境変数): TRIGGER_NAME・TAG_NAME・COMMIT_SHA・BUILD_ID・REGION・REPO_FULL_NAME・ALLOW_UNVERIFIED_SOURCE・
# SOURCE_GIT_URL・SOURCE_REPOSITORY・RELEASE_BRANCH(既定 main)
set -euo pipefail

fail() {
  echo "verify-source: $1" >&2
  exit 1
}

TRIGGER_NAME="${TRIGGER_NAME:-}"
TAG_NAME="${TAG_NAME:-}"
COMMIT_SHA="${COMMIT_SHA:-}"
BUILD_ID="${BUILD_ID:-}"
REGION="${REGION:-}"
REPO_FULL_NAME="${REPO_FULL_NAME:-}"
ALLOW_UNVERIFIED_SOURCE="${ALLOW_UNVERIFIED_SOURCE:-false}"
SOURCE_GIT_URL="${SOURCE_GIT_URL:-}"
SOURCE_REPOSITORY="${SOURCE_REPOSITORY:-}"
RELEASE_BRANCH="${RELEASE_BRANCH:-main}"

if [ -z "$TRIGGER_NAME" ]; then
  if [ "$ALLOW_UNVERIFIED_SOURCE" = true ]; then
    echo "verify-source: 手元からの実行(_ALLOW_UNVERIFIED_SOURCE=true)。ソースが main のタグか・承認されたかは確かめません"
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

# 読む先はトリガーのリポジトリに固定する(_SOURCE_GIT_URL・_SOURCE_REPOSITORY は置換で変えられるため)
[[ "$REPO_FULL_NAME" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] \
  || fail "REPO_FULL_NAME(トリガーのリポジトリ)が owner/repo の形ではありません: '${REPO_FULL_NAME}'"
expected_url="https://github.com/${REPO_FULL_NAME}.git"
[ "$SOURCE_GIT_URL" = "$expected_url" ] \
  || fail "_SOURCE_GIT_URL('${SOURCE_GIT_URL}')がトリガーのリポジトリ ${expected_url} ではありません"
[[ "$SOURCE_REPOSITORY" =~ ^projects/[^/]+/locations/[^/]+/connections/[^/]+/repositories/[^/]+$ ]] \
  || fail "_SOURCE_REPOSITORY が projects/…/locations/…/connections/…/repositories/… の形ではありません: '${SOURCE_REPOSITORY}'"
[[ "$BUILD_ID" =~ ^[A-Za-z0-9-]+$ ]] || fail "BUILD_ID がありません: '${BUILD_ID}'"
[[ "$REGION" =~ ^[a-z0-9-]+$ ]] || fail "REGION がありません: '${REGION}'"

for cmd in git curl python3 gcloud base64; do
  command -v "$cmd" >/dev/null || fail "${cmd} がありません(ステップのイメージを確かめる)"
done

# このビルドが承認されて動いているか(トリガーの承認が外されていれば approval が無く空になる)
approval_state="$(gcloud builds describe "$BUILD_ID" --region="$REGION" --format='value(approval.state)')" \
  || fail "ビルド ${BUILD_ID} の承認の状態を読めません(ビルドの SA に roles/cloudbuild.builds.viewer が要る。doc/07 4.1)"
[ "$approval_state" = APPROVED ] \
  || fail "ビルド ${BUILD_ID} は承認されていません(approval.state='${approval_state}')。トリガー ${TRIGGER_NAME} の承認を必須に戻す(doc/07 4.1 の 4)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

export GIT_TERMINAL_PROMPT=0
access_token="$(gcloud auth print-access-token)" || fail "ビルドの SA のアクセストークンを得られません"
# アクセストークンはコマンドの引数に載せず(ps・/proc から見える)、ヘッダーのファイルで curl に渡す(printf は組み込みのコマンド)
(umask 077 && printf 'Authorization: Bearer %s\n' "$access_token" >"$work/auth-header")
response="$(curl -fsS -X POST -H @"$work/auth-header" -H 'Content-Type: application/json' -d '{}' \
  "https://cloudbuild.googleapis.com/v2/${SOURCE_REPOSITORY}:accessReadToken")" \
  || fail "リポジトリを読むトークンを得られません(ビルドの SA に roles/cloudbuild.readTokenAccessor が要る。doc/07 4.1)"
rm -f "$work/auth-header"
read_token="$(printf '%s' "$response" | python3 -c 'import json, sys; print(json.load(sys.stdin)["token"])')" \
  || fail "accessReadToken の応答に token がありません"
# GitHub のトークンも引数・URL に載せず、環境変数の git の設定でヘッダーとして渡す(actions/checkout と同じ形)
basic="$(printf 'x-access-token:%s' "$read_token" | base64 | tr -d '\n')"
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0="http.https://github.com/.extraheader"
export GIT_CONFIG_VALUE_0="Authorization: basic ${basic}"

# タグの行(軽量タグはコミット、注釈つきタグはタグのオブジェクト)と、注釈つきタグの ^{} の行(指す先のコミット)
refs="$(git ls-remote "$SOURCE_GIT_URL" "refs/tags/${TAG_NAME}" "refs/tags/${TAG_NAME}^{}")" \
  || fail "${SOURCE_GIT_URL} のタグを読めません"
tag_ref_sha="$(awk -v r="refs/tags/${TAG_NAME}" '$2 == r { print $1 }' <<<"$refs")"
peeled_sha="$(awk -v r="refs/tags/${TAG_NAME}^{}" '$2 == r { print $1 }' <<<"$refs")"
[ -n "$tag_ref_sha" ] || fail "GitHub にタグ ${TAG_NAME} がありません"
if [ -n "$peeled_sha" ]; then
  tag_commit="$peeled_sha"
  if [ "$COMMIT_SHA" = "$peeled_sha" ]; then
    matched="注釈つきタグの指す先のコミットと一致"
  elif [ "$COMMIT_SHA" = "$tag_ref_sha" ]; then
    matched="注釈つきタグのオブジェクト ${tag_ref_sha:0:7} と一致。指す先のコミット ${peeled_sha:0:7} で main を確かめる"
  else
    fail "タグ ${TAG_NAME}(オブジェクト ${tag_ref_sha}、指す先のコミット ${peeled_sha})は、ビルドしている ${COMMIT_SHA} ではありません"
  fi
else
  tag_commit="$tag_ref_sha"
  [ "$COMMIT_SHA" = "$tag_commit" ] \
    || fail "タグ ${TAG_NAME} は ${tag_commit} を指しており、ビルドしている ${COMMIT_SHA} ではありません"
  matched="軽量タグのコミットと一致"
fi
echo "verify-source: COMMIT_SHA ${COMMIT_SHA:0:7} は${matched}"

# main の履歴(コミットだけ。ツリー・ファイルは取らない)に、タグが指す先のコミットが含まれるか
git clone --quiet --bare --no-tags --single-branch --branch "$RELEASE_BRANCH" --filter=tree:0 "$SOURCE_GIT_URL" "$work/repo" \
  || fail "${SOURCE_GIT_URL} の ${RELEASE_BRANCH} を読めません"
# merge-base は手元に無いコミットを取りに行くことがある(部分クローン)ため、main から辿れるコミットの一覧で確かめる
git -C "$work/repo" rev-list "refs/heads/${RELEASE_BRANCH}" >"$work/commits"
grep -qxF "$tag_commit" "$work/commits" || fail "${tag_commit} は ${RELEASE_BRANCH} に含まれていません"

echo "verify-source: ${TAG_NAME} = ${tag_commit:0:7}(${RELEASE_BRANCH} に含まれる。ビルド ${BUILD_ID} は承認済み)"
