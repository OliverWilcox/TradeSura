@echo off
rem Local Prisma Postgres keeps exiting when run unattended on this machine;
rem loop it. Data persists across restarts (PGlite data dir).
:loop
call npx prisma dev
echo prisma dev exited with %errorlevel% - restarting in 2s
rem ping instead of timeout: works without stdin (harness redirects input)
ping -n 3 127.0.0.1 >nul
goto loop
