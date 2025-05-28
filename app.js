Thread2 is attempting to withdraw amount:->300
Thread1 is attempting to withdraw amount:->300
Server is running busy.Try after few minutes.
Exception in thread "Thread1" java.lang.IllegalMonitorStateException
	at java.base/java.util.concurrent.locks.ReentrantLock$Sync.tryRelease(ReentrantLock.java:176)
	at java.base/java.util.concurrent.locks.AbstractQueuedSynchronizer.release(AbstractQueuedSynchronizer.java:1059)
	at java.base/java.util.concurrent.locks.ReentrantLock.unlock(ReentrantLock.java:495)
	at elTest.BA.withdraw(BA.java:31)
	at elTest.Main$1.run(Main.java:9)
	at java.base/java.lang.Thread.run(Thread.java:1575)
Transaction is being processed successfully.Remaining balance After transaction by Thread2 : 4700

Process finished with exit code 0
