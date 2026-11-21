"""DB 백업: 실행 중인 서버를 멈추지 않고 일관된 스냅샷을 만들고, 오래된 백업을 지운다.

사용법 (프로젝트 폴더에서):
  python scripts/backup.py                 # backups/ 에 저장, 최근 14개 보관
  python scripts/backup.py --keep 30 --dir D:/backup/mdcv

매일 자동 실행(Windows 작업 스케줄러, 관리자 PowerShell):
  schtasks /Create /SC DAILY /ST 02:00 /TN "MDCV 백업" /TR "python D:\\경로\\scripts\\backup.py"
토큰 암호화 키 파일(mdcv.key, 또는 MDCV_SECRET 값)도 함께 안전한 곳에 보관해야 복구 후 계정 연동이 유지된다.
"""
import argparse
import glob
import os
import shutil
import sys
from datetime import datetime

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))
from mdcv.crypto import key_file  # noqa: E402
from mdcv.store import Store  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", default=os.path.join(ROOT, "backups"))
    ap.add_argument("--keep", type=int, default=14)
    args = ap.parse_args()
    os.makedirs(args.dir, exist_ok=True)
    name = "mdcv-%s" % datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = os.path.join(args.dir, name + ".db")
    store = Store()
    store.backup(dest)
    if os.path.exists(key_file()):
        shutil.copy2(key_file(), os.path.join(args.dir, name + ".key"))
    for old in sorted(glob.glob(os.path.join(args.dir, "mdcv-*.db")))[:-args.keep]:
        os.remove(old)
        if os.path.exists(old[:-3] + ".key"):
            os.remove(old[:-3] + ".key")
    print("백업 완료:", os.path.abspath(dest), "(%.1f MB)" % (os.path.getsize(dest) / 1e6))


if __name__ == "__main__":
    main()
