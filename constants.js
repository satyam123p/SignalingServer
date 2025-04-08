#include <libwebsockets.h>
#include <string>
#include <functional>
#include <queue>
#include <mutex>
#include <condition_variable>

class WebSocketClient {
public:
    WebSocketClient(const std::string& ip, int port, const std::string& path = "/");
    ~WebSocketClient();

    // Connect to the WebSocket server
    bool connect();

    // Send a message to the server
    bool sendMessage(const std::string& message);

    // Set callback for received messages
    void setMessageCallback(std::function<void(const std::string&)> callback);

    // Disconnect from the server
    void disconnect();

private:
    // Callback function for libwebsockets
    static int callback(struct lws* wsi, enum lws_callback_reasons reason,
                       void* user, void* in, size_t len);

    // Internal message handling
    void processReceivedMessage(const char* message, size_t len);

    // Service thread function
    void serviceThread();

    struct lws_context* context;
    struct lws* wsi;
    struct lws_client_connect_info connect_info;
    
    std::string server_ip;
    int server_port;
    std::string server_path;
    
    std::queue<std::string> send_queue;
    std::mutex queue_mutex;
    std::condition_variable queue_cv;
    bool running;
    
    std::function<void(const std::string&)> message_callback;
    std::thread* service_thread;
};

// Implementation

WebSocketClient::WebSocketClient(const std::string& ip, int port, const std::string& path)
    : context(nullptr), wsi(nullptr), server_ip(ip), server_port(port),
      server_path(path), running(false), service_thread(nullptr) {
    lws_set_log_level(LLL_ERR | LLL_WARN, nullptr);
}

WebSocketClient::~WebSocketClient() {
    disconnect();
}

bool WebSocketClient::connect() {
    struct lws_context_creation_info info = {0};
    info.port = CONTEXT_PORT_NO_LISTEN;
    info.protocols = protocols;
    info.options = 0;
    info.user = this;

    context = lws_create_context(&info);
    if (!context) {
        return false;
    }

    connect_info = {0};
    connect_info.context = context;
    connect_info.address = server_ip.c_str();
    connect_info.port = server_port;
    connect_info.path = server_path.c_str();
    connect_info.host = connect_info.address;
    connect_info.origin = connect_info.address;
    connect_info.protocol = protocols[0].name;
    connect_info.userdata = this;

    wsi = lws_client_connect_via_info(&connect_info);
    if (!wsi) {
        lws_context_destroy(context);
        context = nullptr;
        return false;
    }

    running = true;
    service_thread = new std::thread(&WebSocketClient::serviceThread, this);
    return true;
}

bool WebSocketClient::sendMessage(const std::string& message) {
    if (!wsi || !running) return false;

    std::lock_guard<std::mutex> lock(queue_mutex);
    send_queue.push(message);
    queue_cv.notify_one();
    return true;
}

void WebSocketClient::setMessageCallback(std::function<void(const std::string&)> callback) {
    message_callback = callback;
}

void WebSocketClient::disconnect() {
    if (running) {
        running = false;
        if (service_thread) {
            service_thread->join();
            delete service_thread;
            service_thread = nullptr;
        }
        if (context) {
            lws_context_destroy(context);
            context = nullptr;
        }
    }
}

void WebSocketClient::serviceThread() {
    while (running) {
        lws_service(context, 50);

        // Handle sending queued messages
        std::unique_lock<std::mutex> lock(queue_mutex);
        if (!send_queue.empty() && wsi) {
            std::string message = send_queue.front();
            send_queue.pop();
            lock.unlock();

            size_t len = message.length();
            unsigned char* buf = new unsigned char[LWS_PRE + len];
            memcpy(buf + LWS_PRE, message.c_str(), len);
            lws_write(wsi, buf + LWS_PRE, len, LWS_WRITE_TEXT);
            delete[] buf;
        }
        else {
            queue_cv.wait_for(lock, std::chrono::milliseconds(50),
                            [this]() { return !send_queue.empty() || !running; });
        }
    }
}

void WebSocketClient::processReceivedMessage(const char* message, size_t len) {
    if (message_callback) {
        message_callback(std::string(message, len));
    }
}

int WebSocketClient::callback(struct lws* wsi, enum lws_callback_reasons reason,
                             void* user, void* in, size_t len) {
    WebSocketClient* client = static_cast<WebSocketClient*>(user);
    
    switch (reason) {
        case LWS_CALLBACK_CLIENT_ESTABLISHED:
            client->wsi = wsi;
            break;

        case LWS_CALLBACK_CLIENT_RECEIVE:
            client->processReceivedMessage((const char*)in, len);
            break;

        case LWS_CALLBACK_CLIENT_CONNECTION_ERROR:
        case LWS_CALLBACK_CLOSED:
            client->wsi = nullptr;
            client->running = false;
            break;

        case LWS_CALLBACK_CLIENT_WRITEABLE:
            lws_callback_on_writable(wsi);
            break;

        default:
            break;
    }
    return 0;
}

static struct lws_protocols protocols[] = {
    {
        "default",
        WebSocketClient::callback,
        0,
        0,
    },
    { nullptr, nullptr, 0, 0 } // terminator
};

// Example usage:
int main() {
    WebSocketClient client("localhost", 8080, "/");
    
    // Set callback for incoming messages
    client.setMessageCallback([](const std::string& message) {
        std::cout << "Received: " << message << std::endl;
    });

    // Connect to server
    if (client.connect()) {
        std::cout << "Connected to server" << std::endl;
        
        // Send a test message
        client.sendMessage("Hello, Server!");
        
        // Keep program running for a while
        std::this_thread::sleep_for(std::chrono::seconds(5));
        
        // Disconnect
        client.disconnect();
    }
    return 0;
    }
