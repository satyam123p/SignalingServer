package elTest;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantLock;
public class BA {
    private int bal = 5000;
    private final Lock lock = new ReentrantLock();
    public void withdraw(int amount) {
        System.out.println(Thread.currentThread().getName() + " is attempting to withdraw amount:->" + amount);
        try {
            if (lock.tryLock(1000,TimeUnit.MILLISECONDS)) {
                try{
                    if (amount<=bal){
                        Thread.sleep(5000);
                        bal = bal-amount;
                        System.out.println("Transaction is being processed successfully.Remaining balance After transaction by " + Thread.currentThread().getName() + " : "+ bal);
                    }else{
                        System.out.println("Insufficient balance.");
                    }
                }catch(Exception e){
                    System.out.println("Exception occurred here check it :->" + e);
                    Thread.currentThread().interrupt();
                }
                finally{
                    lock.unlock();
                }
            } else {
                System.out.println("Server is running busy.Try after few minutes " + Thread.currentThread().getName() + ".");
            }
        } catch (InterruptedException e) {
            System.out.println("Thread is interrupted.");
            Thread.currentThread().interrupt();
        }
    }
}

package elTest;
public class Main {
    public static void main(String[] args) {
        try{
            BA  b = new BA();
            Runnable task = new Runnable() {
                @Override
                public void run() {
                    b.withdraw(300);
                }
            };
            Thread t1  = new Thread(task,"Thread1");
            Thread t2 = new Thread(task,"Thread2");
            t1.start();
            t2.start();
        }catch (Exception e){
            System.out.println("See what happens->" + e);
        }
    }
}





