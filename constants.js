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






#include <libwebsockets.h>
#include <string>
#include <functional>
#include <queue>
#include <mutex>
#include <condition_variable>
#include <thread>
#include <iostream>
#include <memory>

class WebSocketClient {
public:
    WebSocketClient(const std::string& ip, int port, const std::string& path = "/");
    ~WebSocketClient();

    bool connect();
    bool sendMessage(const std::string& message);
    void setMessageCallback(std::function<void(const std::string&)> callback);
    void disconnect();

private:
    static int callback(struct lws* wsi, enum lws_callback_reasons reason,
                        void* user, void* in, size_t len);
    void processReceivedMessage(const char* message, size_t len);
    void serviceThread();
    void sendPendingMessages();

    static struct lws_protocols protocols[];

    struct lws_context* context;
    struct lws* wsi;
    struct lws_client_connect_info connect_info;
    
    std::string server_ip;
    int server_port;
    std::string server_path;
    
    std::queue<std::string> send_queue;
    std::mutex queue_mutex;
    std::mutex wsi_mutex; // Protect wsi access
    std::condition_variable queue_cv;
    bool running;
    
    std::function<void(const std::string&)> message_callback;
    std::thread* service_thread;
};

struct lws_protocols WebSocketClient::protocols[] = {
    {
        "default",
        WebSocketClient::callback,
        0,
        0,
    },
    { nullptr, nullptr, 0, 0 } // Terminator
};

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
        std::cerr << "Failed to create context" << std::endl;
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
        std::cerr << "Failed to connect" << std::endl;
        return false;
    }

    running = true;
    service_thread = new std::thread(&WebSocketClient::serviceThread, this);
    return true;
}

bool WebSocketClient::sendMessage(const std::string& message) {
    std::lock_guard<std::mutex> lock(queue_mutex);
    if (!running) return false;

    send_queue.push(message);
    queue_cv.notify_one();
    {
        std::lock_guard<std::mutex> wsi_lock(wsi_mutex);
        if (wsi) lws_callback_on_writable(wsi); // Request writable callback
    }
    return true;
}

void WebSocketClient::setMessageCallback(std::function<void(const std::string&)> callback) {
    message_callback = callback;
}

void WebSocketClient::disconnect() {
    if (running) {
        running = false;
        queue_cv.notify_one(); // Wake up service thread to exit
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

void WebSocketClient::sendPendingMessages() {
    std::lock_guard<std::mutex> lock(queue_mutex);
    std::lock_guard<std::mutex> wsi_lock(wsi_mutex);

    if (!wsi || !running) return;

    while (!send_queue.empty()) {
        std::string message = send_queue.front();
        size_t len = message.length();
        std::unique_ptr<unsigned char[]> buf(new unsigned char[LWS_PRE + len]);
        memcpy(buf.get() + LWS_PRE, message.c_str(), len);

        int bytes_written = lws_write(wsi, buf.get() + LWS_PRE, len, LWS_WRITE_TEXT);
        if (bytes_written < 0 || static_cast<size_t>(bytes_written) < len) {
            std::cerr << "Failed to send message" << std::endl;
            return;
        }
        send_queue.pop();
    }
}

void WebSocketClient::serviceThread() {
    while (running) {
        lws_service(context, 50); // Poll every 50ms
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
            {
                std::lock_guard<std::mutex> lock(client->wsi_mutex);
                client->wsi = wsi;
            }
            std::cout << "Connection established" << std::endl;
            break;

        case LWS_CALLBACK_CLIENT_RECEIVE:
            client->processReceivedMessage((const char*)in, len);
            break;

        case LWS_CALLBACK_CLIENT_CONNECTION_ERROR:
        case LWS_CALLBACK_CLOSED:
            {
                std::lock_guard<std::mutex> lock(client->wsi_mutex);
                client->wsi = nullptr;
            }
            client->running = false;
            std::cout << "Connection closed or error" << std::endl;
            break;

        case LWS_CALLBACK_CLIENT_WRITEABLE:
            client->sendPendingMessages();
            break;

        default:
            break;
    }
    return 0;
}

int main() {
    WebSocketClient client("localhost", 8080, "/");
    
    client.setMessageCallback([](const std::string& message) {
        std::cout << "Received: " << message << std::endl;
    });

    if (client.connect()) {
        std::cout << "Connected to server" << std::endl;
        
        client.sendMessage("Hello, Server!");
        
        std::this_thread::sleep_for(std::chrono::seconds(5));
        
        client.disconnect();
    } else {
        std::cout << "Failed to connect" << std::endl;
    }
    return 0;
         






}








#include <libwebsockets.h>
#include <signal.h>
#include <string.h>
#include <iostream>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

static int interrupted = 0;
static struct lws_context *context;
static struct lws *web_socket = nullptr;
static bool message_sent = false;

static int callback_websockets(struct lws *wsi, enum lws_callback_reasons reason,
                               void *user, void *in, size_t len) {
    switch (reason) {
        case LWS_CALLBACK_CLIENT_ESTABLISHED:
            std::cout << "[Client] Connected to signaling server\n";
            lws_callback_on_writable(wsi);
            break;

        case LWS_CALLBACK_CLIENT_RECEIVE:
            std::cout << "[Server] " << std::string((char *)in, len) << std::endl;
            break;

        case LWS_CALLBACK_CLIENT_WRITEABLE: {
            if (!message_sent) {
                // Create a structured signaling message
                json msg_json = {
                    {"type", "hello"},
                    {"data", "Hello from C++ WebSocket client"}
                };

                std::string msg = msg_json.dump();
                size_t msg_len = msg.length();
                if (msg_len > 1024) msg_len = 1024; // buffer safety

                unsigned char buf[LWS_PRE + 1024];
                memcpy(&buf[LWS_PRE], msg.c_str(), msg_len);

                int n = lws_write(wsi, &buf[LWS_PRE], msg_len, LWS_WRITE_TEXT);
                if (n < 0) {
                    std::cerr << "[Error] Failed to write to server\n";
                } else {
                    std::cout << "[Client] Sent message to server\n";
                    message_sent = true;
                }
            }
            break;
        }

        case LWS_CALLBACK_CLOSED:
            std::cout << "[Client] Disconnected from server\n";
            interrupted = 1;
            break;

        default:
            break;
    }

    return 0;
}

static struct lws_protocols protocols[] = {
    {
        "example-protocol",
        callback_websockets,
        0,
        1024,
    },
    { NULL, NULL, 0, 0 }
};

void sigint_handler(int sig) {
    interrupted = 1;
}

int main() {
    signal(SIGINT, sigint_handler);

    struct lws_context_creation_info ctx_info = {};
    ctx_info.port = CONTEXT_PORT_NO_LISTEN;
    ctx_info.protocols = protocols;
    ctx_info.options = LWS_SERVER_OPTION_DO_SSL_GLOBAL_INIT;

    context = lws_create_context(&ctx_info);
    if (!context) {
        std::cerr << "lws init failed\n";
        return -1;
    }

    struct lws_client_connect_info conn_info = {};
    conn_info.context = context;
    conn_info.address = "localhost";
    conn_info.port = 8080;
    conn_info.path = "/";
    conn_info.host = conn_info.address;
    conn_info.origin = conn_info.address;
    conn_info.protocol = protocols[0].name;
    conn_info.ssl_connection = 0;

    web_socket = lws_client_connect_via_info(&conn_info);
    if (!web_socket) {
        std::cerr << "WebSocket connection failed\n";
        return -1;
    }

    while (!interrupted) {
        lws_service(context, 100);
    }

    lws_context_destroy(context);

    return 0;
}
