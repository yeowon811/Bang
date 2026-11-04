@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo 황야의 결투 개발 서버를 시작합니다... (종료: Ctrl+C)
echo 브라우저에서 http://localhost:5173 을 여세요.
echo.
if not exist node_modules (
  echo 처음 실행: 패키지를 설치합니다...
  call npm.cmd install
)
call npm.cmd run dev
echo.
echo 서버가 종료되었습니다. 위 메시지를 확인하세요.
pause
