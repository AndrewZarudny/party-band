-- Fretwise.app: built by mac/install.sh with osacompile (a stay-open applet).
-- Opening it starts Fretwise and shows it in the browser; clicking its Dock icon again shows it again;
-- quitting it stops Fretwise. __FRETWISE_DIR__ is replaced with the project folder when the app is built.
property projectDir : "__FRETWISE_DIR__"

on showFretwise()
	do shell script quoted form of (projectDir & "/mac/start.sh") & " > /dev/null 2>&1 &"
end showFretwise

on run
	showFretwise()
end run

on reopen
	showFretwise()
end reopen

on quit
	try
		do shell script quoted form of (projectDir & "/mac/stop.sh")
	end try
	continue quit
end quit
