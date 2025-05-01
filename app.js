import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  SafeAreaView,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCDataChannel,
} from 'react-native-webrtc';

const App = () => {
  let pc;
  let dataChannel;
  const iceCandidatesGenerated = [];
  const iceCandidatesReceivedBuffer = [];

const type = {
    ROOM_CREATE: {
        RESPONSE_FAILURE: "CHECK_ROOM_RESPONSE_FAILURE",
        RESPONSE_SUCCESS: "CHECK_ROOM_RESPONSE_SUCCESS", 
    },
    ROOM_DESTROY: {
        RESPONSE_FAILURE: "DESTROY_ROOM_RESPONSE_FAILURE",
        RESPONSE_SUCCESS: "DESTORY_ROOM_RESPONSE_SUCCESS", 
    },
    ROOM_JOIN: {
        RESPONSE_FAILURE: "JOIN_ROOM_RESPONSE_FAILURE",
        RESPONSE_SUCCESS: "JOIN_ROOM_RESPONSE_SUCCESS",
        REQUEST: "JOIN_ROOM_REQUEST",
        NOTIFY: "JOIN_ROOM_NOTIFY" 
    },
    ROOM_EXIT: {
        REQUEST: "EXIT_ROOM_REQUEST",
        NOTIFY: "EXIT_ROOM_NOTIFY" 
    },
    ROOM_DISONNECTION: {
        NOTIFY: "DISCONNECT_ROOM_NOTIFICATION"
    },
    WEB_RTC: {
        OFFER: "OFFER",
        ANSWER: "ANSWER",
        ICE_CANDIDATES: "ICE_CANDIDATES"
    }
};
const labels = {
    NORMAL_SERVER_PROCESS: "NORMAL_SERVER_PROCESS",
    WEBRTC_PROCESS: "WEBRTC_PROCESS"
};

let  userId=null;
let roomName=null;
let otherUserId=null;
let wsConnection=null;

// Refs for UI components
const inputRoomNameElement = useRef(null);
const joinRoomButton = useRef(null);
const createRoomButton = useRef(null);
const messageInputField = useRef(null);
const sendMessageButton = useRef(null);
const destroyRoomButton = useRef(null);
const exitButton = useRef(null);
const messageContainer = useRef(null);
// WebRTC configuration
const webRTCConfiguratons = {
    iceServers: [
        {
            urls: [
                "stun:stun.l.google.com:19302",
                "stun:stun2.l.google.com:19302",
                "stun:stun3.l.google.com:19302",
                "stun:stun4.l.google.com:19302",
            ]
        }
    ]
};
function exitRoom() {
    if (inputRoomNameElement.current) {
        inputRoomNameElement.current.clear();
    }
    roomName=null;
    otherUserId=null;
}

function updateUiForRemainingUser() {
    Alert.alert("Notification", "A user has left your room");
    otherUserId=null;
}

function addOutgoingMessageToUi(message) {
    const userTag = "YOU";
    const formattedMessage = `${userTag}: ${message}`;
    return formattedMessage; 
}

function addIncomingMessageToUi(msg) {
    const formattedMessage = `${otherUserId}: ${msg}`;
    return formattedMessage;
}

function createRoom(roomName, userId) {
    fetch('http://10.0.2.2:8080/create-room', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }, 
        body: JSON.stringify({ roomName, userId })
    })
    .then(response => response.json())
    .then(resObj => {   
        if (resObj.data.type === type.ROOM_CREATE.RESPONSE_SUCCESS) {
            roomName=roomName;
            Alert.alert("Success", "Room created successfully.");
        }
        if (resObj.data.type === type.ROOM_CREATE.RESPONSE_FAILURE) {
            console.log("Create Room Failure->", resObj.data.message);
        }
    })
    .catch(err => {
        console.log("An error occurred trying to create a room:-> ", err);
    });
}

function destroyRoom(roomName) {
    fetch('http://10.0.2.2:8080/destroy-room', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }, 
        body: JSON.stringify({ roomName })
    })
    .then(response => response.json())
    .then(resObj => {   
        if (resObj.data.type === type.ROOM_DESTROY.RESPONSE_SUCCESS) {
            exitRoom();
        }
        if (resObj.data.type === type.ROOM_DESTROY.RESPONSE_FAILURE) {
            console.log(resObj.data.message);
        }
    })
    .catch(err => {
        console.log("An error occurred trying to destroy a room: ", err);
    });
}

// WebSocket event listeners
function registerSocketEvents() {
    wsConnection.onopen = () => {
        console.log("You have connected with our websocket server");
        wsConnection.onmessage = handleMessage;
        wsConnection.onclose = handleClose;
        wsConnection.onerror = handleError;
    };
}

function handleClose() {
    console.log("You have been disconnected from our ws server");
}

function handleError() {
    console.log("An error was thrown while listening on onerror event on websocket");
}

function joinRoom(roomName, userId) {
    const message = {
        label: labels.NORMAL_SERVER_PROCESS,
        data: {
            type: type.ROOM_JOIN.REQUEST,
            roomName,
            userId
        }
    };
    wsConnection.send(JSON.stringify(message));
}
function sendExitRoomRequest(roomName, userId) {
    const message = {
        label: labels.NORMAL_SERVER_PROCESS,
        data: {
            type: type.ROOM_EXIT.REQUEST,
            roomName,
            userId
        }
    };
    wsConnection.send(JSON.stringify(message));
}

function sendOffer(offer) {
    const message = {
        label: labels.WEBRTC_PROCESS,
        data: {
            type: type.WEB_RTC.OFFER,
            offer, 
            otherUserId:otherUserId
        }
    };
    wsConnection.send(JSON.stringify(message));
}

function sendAnswer(answer) {
    const message = {
        label: labels.WEBRTC_PROCESS, 
        data: {
            type: type.WEB_RTC.ANSWER,
            answer, 
            otherUserId:otherUserId
        }
    };
    wsConnection.send(JSON.stringify(message));
}

function sendIceCandidates(arrayOfIceCandidates) {
    const message = {
        label: labels.WEBRTC_PROCESS,
        data: {
            type: type.WEB_RTC.ICE_CANDIDATES,
            candidatesArray: arrayOfIceCandidates,
            otherUserId: otherUserId
        }
    };
    wsConnection.send(JSON.stringify(message));
}

function handleMessage(incomingMessageEventObject) {
    const message = JSON.parse(incomingMessageEventObject.data);
    switch (message.label) {
        case labels.NORMAL_SERVER_PROCESS:
            normalServerProcessing(message.data);
            break;
        case labels.WEBRTC_PROCESS:
            webRTCServerProcessing(message.data);
            break;
        default: 
            console.log("Unknown server processing label: ", message.label);
    }
}

function normalServerProcessing(data) {
    switch (data.type) {
        case type.ROOM_JOIN.RESPONSE_SUCCESS: 
            joinSuccessHandler(data);
            Alert.alert("Success", "Join room successful");
            break; 
        case type.ROOM_JOIN.RESPONSE_FAILURE: 
            console.log("Join room failed");
            break; 
        case type.ROOM_JOIN.NOTIFY: 
            joinNotificationHandler(data);
            break; 
        case type.ROOM_EXIT.NOTIFY:
            exitNotificationHandler(data);
            break;
        case type.ROOM_DISONNECTION.NOTIFY:
            exitNotificationHandler(data);
            break;
        default: 
            console.log("Unknown data type: ", data.type);
    }
}

function webRTCServerProcessing(data) {
    switch (data.type) {
        case type.WEB_RTC.OFFER:
            handleOffer(data);
            break;
        case type.WEB_RTC.ANSWER:
            handleAnswer(data);
            break; 
        case type.WEB_RTC.ICE_CANDIDATES:
            handleIceCandidates(data);
            break; 
        default: 
            console.log("Unknown data type: ", data.type);
    }
}

function joinSuccessHandler(data) {
    otherUserId = data.creatorId
    roomName= data.roomName;
    startWebRTCProcess(); 
}

function joinNotificationHandler(data) {
    Alert.alert("Notification", `User ${data.joinUserId} has joined your room`);
    otherUserId = data.joinUserId
}

function exitNotificationHandler() {
    updateUiForRemainingUser();
    closePeerConnection();
}

// WebRTC functions
function startWebRTCProcess() {
    createPeerConnectionObject();
    createDataChannel(true);

    pc.current?.createOffer().then(function(createdOffer) {
        const offer = createdOffer;
        return pc.current?.setLocalDescription(offer);
    }).then(function() {
        sendOffer(pc.current?.localDescription);
    }).catch(function(error) {
        console.error('Error occurred during WebRTC process:', error);
    });
}

function createPeerConnectionObject() {
    pc.current = new RTCPeerConnection(webRTCConfiguratons);
    pc.current.onconnectionstatechange = () => {
        console.log("Connection state changed to: ", pc.current?.connectionState); 
        if (pc.current?.connectionState === "connected") {
            Alert.alert("Success", "YOU HAVE DONE IT! A WEBRTC CONNECTION HAS BEEN MADE BETWEEN YOU AND THE OTHER PEER");
        }
    };
    pc.current.onsignalingstatechange = () => {
        console.log(`Signaling state changed to: ${pc.current?.signalingState}`);
    };
    pc.current.onicecandidate = (e) => {
        if (e.candidate) {
            console.log("ICE:", e.candidate);
            iceCandidatesGenerated.current.push(e.candidate);
        }
    };
}

function createDataChannel(isOfferor) {
    if (isOfferor) {
        const dataChannelOptions = {
            ordered: false, 
            maxRetransmits: 0
        };
        dataChannel.current = pc.current?.createDataChannel("top-secret-chat-room", dataChannelOptions);
        registerDataChannelEventListeners();
    } else {
        pc.current.ondatachannel = (e) => {
            console.log("The ondatachannel event was emitted for PEER2. Here is the event object: ", e);
            dataChannel.current = e.channel;
            registerDataChannelEventListeners();
        };
    }
}

function registerDataChannelEventListeners() {
    dataChannel.current.onmessage = (e) => {
        console.log("Message has been received from a Data Channel");
        const msg = e.data; 
        const formattedMessage = addIncomingMessageToUi(msg);
        setMessages((prevMessages) => [...prevMessages, formattedMessage]);
    };
    dataChannel.current.onclose = () => {
        console.log("The 'close' event was fired on your data channel object");
    };
    dataChannel.current.onopen = () => { 
        console.log("Data Channel has been opened. You are now ready to send/receive messages over your Data Channel");
    };
}

async function handleOffer(data) {
    let answer; 
    createPeerConnectionObject(); 
    createDataChannel(false);
    await pc.current?.setRemoteDescription(data.offer);
    answer = await pc.current?.createAnswer();
    await pc.current?.setLocalDescription(answer);
    sendAnswer(answer);
    sendIceCandidates(iceCandidatesGenerated.current);
}

async function handleAnswer(data) {
    sendIceCandidates(iceCandidatesGenerated.current);
    await pc.current?.setRemoteDescription(data.answer);
    for (const candidate of iceCandidatesReceivedBuffer.current) {
        await pc.current?.addIceCandidate(candidate);
    }; 
    iceCandidatesReceivedBuffer.current.splice(0, iceCandidatesReceivedBuffer.current.length);
}

function handleIceCandidates(data) {
    if (pc.current?.remoteDescription) {
        try {
            data.candidatesArray.forEach((candidate) => {
                pc.current?.addIceCandidate(new RTCIceCandidate(candidate));
            });
        } catch (error) {
            console.log("Error trying to add an ICE candidate to the pc object", error);
        }
    } else {
        data.candidatesArray.forEach((candidate) => {
            iceCandidatesReceivedBuffer.current.push(new RTCIceCandidate(candidate));
        });
    }   
}

function sendMessageUsingDataChannel(message) {
    dataChannel.current?.send(message);
}

function closePeerConnection() {
    if (pc.current) {
        pc.current.close();
        pc.current = null;
        dataChannel.current = null;
        console.log("You have closed your peer connection by calling the 'close()' method");
    }
}
  const [channelName, setChannelName] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  userId = useState(Math.round(Math.random() * 1000000).toString());

  // Initialize UI and WebSocket
  useEffect(() => {
   wsConnection = new WebSocket(`ws://10.0.2.2:8080/?userId=${userId}`);
    registerSocketEvents();
  }, []);

  // Button handlers
  const handleCreateRoom = () => {
    roomName = channelName.trim();
    setChannelName('');
    if (!roomName) {
      Alert.alert("Error", "Your room needs a name");
      return;
    }
    createRoom(roomName, userId);
  };

  const handleDestroyRoom = () => {
    if (roomName) {
      destroyRoom(roomName);
    }
  };

  const handleJoinRoom = () => {
    roomName = channelName.trim();
    setChannelName('');
    if (!roomName) {
      Alert.alert("Error", "You have to join a room with a valid name");
      return;
    }
    joinRoom(roomName, userId);
  };

  const handleExitRoom = () => {
    exitRoom();
    if (roomName) {
      sendExitRoomRequest(roomName, userId);
    }
    closePeerConnection();
  };

  const handleSendMessage = () => {
    const msg = message.trim();
    setMessage('');
    if (msg) {
      const formattedMessage = addOutgoingMessageToUi(msg);
      setMessages((prevMessages) => [...prevMessages, formattedMessage]);
      sendMessageUsingDataChannel(msg);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <Text style={styles.header}>WebRTC Chat Room</Text>

        {/* Channel Name Input */}
        <TextInput
          ref={inputRoomNameElement}
          style={styles.input}
          placeholder="Enter channel name"
          value={channelName}
          onChangeText={setChannelName}
        />

        {/* Buttons for Room Actions */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            ref={createRoomButton}
            style={styles.button}
            onPress={handleCreateRoom}
          >
            <Text style={styles.buttonText}>Create</Text>
          </TouchableOpacity>
          <TouchableOpacity
            ref={joinRoomButton}
            style={styles.button}
            onPress={handleJoinRoom}
          >
            <Text style={styles.buttonText}>Join</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            ref={destroyRoomButton}
            style={styles.button}
            onPress={handleDestroyRoom}
          >
            <Text style={styles.buttonText}>Destroy Room</Text>
          </TouchableOpacity>
          <TouchableOpacity
            ref={exitButton}
            style={styles.button}
            onPress={handleExitRoom}
          >
            <Text style={styles.buttonText}>Exit Room</Text>
          </TouchableOpacity>
        </View>

        {/* Message Input */}
        <TextInput
          ref={messageInputField}
          style={styles.input}
          placeholder="Type a message..."
          value={message}
          onChangeText={setMessage}
        />

        {/* Send Button */}
        <TouchableOpacity
          ref={sendMessageButton}
          style={styles.sendButton}
          onPress={handleSendMessage}
        >
          <Text style={styles.buttonText}>Send</Text>
        </TouchableOpacity>

        {/* Message Container */}
        <View ref={messageContainer} style={styles.messageContainer}>
          {messages.length === 0 ? (
            <Text style={styles.noMessages}>No messages yet</Text>
          ) : (
            messages.map((msg, index) => (
              <Text key={index} style={styles.message}>
                {msg}
              </Text>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContainer: {
    padding: 20,
    alignItems: 'center',
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
  },
  input: {
    width: '100%',
    height: 40,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 10,
    marginBottom: 20,
    backgroundColor: '#fff',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 20,
  },
  button: {
    flex: 1,
    backgroundColor: '#007AFF',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  sendButton: {
    width: '100%',
    backgroundColor: '#007AFF',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
    marginBottom: 20,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  messageContainer: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 5,
    padding: 10,
    minHeight: 100,
  },
  message: {
    fontSize: 14,
    color: '#333',
    marginBottom: 5,
  },
  noMessages: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
});

export default App;

