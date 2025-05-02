

useEffect(() => {
  const connectWebSocket = () => {
    try {
      wsConnection.current = new WebSocket(`ws://10.0.2.2:8080/?userId=${userId}`);
      wsConnection.current.onopen = () => {
        console.log('Connected to WebSocket server');
        // Start ping/pong
        const pingInterval = setInterval(() => {
          if (wsConnection.current?.readyState === WebSocket.OPEN) {
            wsConnection.current.send(JSON.stringify({ type: 'PING' }));
          }
        }, 30000);
      };
      wsConnection.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'PONG') {
            console.log('Received PONG');
            return;
          }
          console.log('Received message:', message);
          switch (message.label) {
            case labels.NORMAL_SERVER_PROCESS:
              normalServerProcessing(message.data);
              break;
            case labels.WEBRTC_PROCESS:
              webRTCServerProcessing(message.data);
              break;
            default:
              console.log('Unknown server processing label:', message.label);
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
          Alert.alert('Error', 'Failed to process server message.');
        }
      };
      wsConnection.current.onclose = () => {
        console.log('Disconnected from WebSocket server');
        clearInterval(pingInterval);
        Alert.alert('Info', 'Disconnected from server. Retrying...');
        setTimeout(connectWebSocket, 10000);
      };
      wsConnection.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        clearInterval(pingInterval);
        Alert.alert('Error', 'Failed to connect to WebSocket server. Retrying...');
      };
    } catch (error) {
      console.error('WebSocket setup error:', error);
      Alert.alert('Error', 'Failed to initialize WebSocket connection.');
    }
  };
  connectWebSocket();
  return () => {
    try {
      wsConnection.current?.close();
    } catch (error) {
      console.error('Error closing WebSocket:', error);
    }
  };
}, [userId]);



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

// Constants
const type = {
  ROOM_CREATE: {
    RESPONSE_SUCCESS: "CHECK_ROOM_RESPONSE_SUCCESS",
    RESPONSE_FAILURE: "CHECK_ROOM_RESPONSE_FAILURE",
  },
  ROOM_JOIN: {
    REQUEST: "JOIN_ROOM_REQUEST",
    RESPONSE_SUCCESS: "JOIN_ROOM_RESPONSE_SUCCESS",
    RESPONSE_FAILURE: "JOIN_ROOM_RESPONSE_FAILURE",
    NOTIFY: "JOIN_ROOM_NOTIFY",
  },
  ROOM_EXIT: {
    REQUEST: "EXIT_ROOM_REQUEST",
    NOTIFY: "EXIT_ROOM_NOTIFY",
  },
  WEB_RTC: {
    OFFER: "OFFER",
    ANSWER: "ANSWER",
    ICE_CANDIDATES: "ICE_CANDIDATES",
  },
};

const labels = {
  NORMAL_SERVER_PROCESS: "NORMAL_SERVER_PROCESS",
  WEBRTC_PROCESS: "WEBRTC_PROCESS",
};

const webRTCConfiguratons = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302',
      ],
    },
  ],
};

// Utility Functions
const addOutgoingMessageToUi = (message, userId) => `${userId}: ${message}`;
const addIncomingMessageToUi = (message, otherUserId) => `${otherUserId}: ${message}`;

const App = () => {
  // State
  const [userId] = useState(Math.round(Math.random() * 1000000).toString());
  const [roomName, setRoomName] = useState('');
  const [otherUserId, setOtherUserId] = useState(null);
  const [channelName, setChannelName] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [iceCandidatesGenerated, setIceCandidatesGenerated] = useState([]);
  const [iceCandidatesReceivedBuffer, setIceCandidatesReceivedBuffer] = useState([]);

  // Refs
  const pc = useRef(null);
  const dataChannel = useRef(null);
  const wsConnection = useRef(null);
  const inputRoomNameElement = useRef(null);

  // WebSocket Setup and Cleanup
  useEffect(() => {
    const connectWebSocket = () => {
      try {
        wsConnection.current = new WebSocket(`ws://10.0.2.2:8080/?userId=${userId}`);

        wsConnection.current.onopen = () => {
          console.log('Connected to WebSocket server');
        };

        wsConnection.current.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            console.log('Received message:', message);
            switch (message.label) {
              case labels.NORMAL_SERVER_PROCESS:
                normalServerProcessing(message.data);
                break;
              case labels.WEBRTC_PROCESS:
                webRTCServerProcessing(message.data);
                break;
              default:
                console.log('Unknown server processing label:', message.label);
            }
          } catch (error) {
            console.error('Error processing WebSocket message:', error);
            Alert.alert('Error', 'Failed to process server message.');
          }
        };

        wsConnection.current.onclose = () => {
          console.log('Disconnected from WebSocket server');
          Alert.alert('Info', 'Disconnected from server. Retrying...');
          setTimeout(connectWebSocket, 10000);
        };

        wsConnection.current.onerror = (error) => {
          console.error('WebSocket error:', error);
          Alert.alert('Error', 'Failed to connect to WebSocket server. Retrying...');
        };
      } catch (error) {
        console.error('WebSocket setup error:', error);
        Alert.alert('Error', 'Failed to initialize WebSocket connection.');
      }
    };

    connectWebSocket();

    return () => {
      try {
        wsConnection.current?.close();
      } catch (error) {
        console.error('Error closing WebSocket:', error);
      }
    };
  }, [userId]);

  // Room Management
  const createRoom = () => {
    const name = channelName.trim();
    setChannelName('');
    if (!name) {
      Alert.alert('Error', 'Your room needs a name');
      return;
    }
    try {
      const message = {
        label: labels.NORMAL_SERVER_PROCESS,
        data: {
          type: type.ROOM_CREATE.RESPONSE_SUCCESS,
          roomName: name,
          userId,
        },
      };
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error creating room:', error);
      Alert.alert('Error', 'Failed to create room.');
    }
  };

  const joinRoom = (name, id) => {
    try {
      const message = {
        label: labels.NORMAL_SERVER_PROCESS,
        data: {
          type: type.ROOM_JOIN.REQUEST,
          roomName: name,
          userId: id,
        },
      };
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error joining room:', error);
      Alert.alert('Error', 'Failed to join room.');
    }
  };

  const sendExitRoomRequest = (name, id) => {
    try {
      const message = {
        label: labels.NORMAL_SERVER_PROCESS,
        data: {
          type: type.ROOM_EXIT.RESPONSE,
          roomName: name,
          userId: id,
        },
      };
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending exit room request:', error);
      Alert.alert('Error', 'Failed to exit room.');
    }
  };

  // WebRTC Functions
  const createPeerConnectionObject = () => {
    try {
      pc.current = new RTCPeerConnection(webRTCConfiguratons);

      pc.current.onconnectionstatechange = () => {
        console.log('Connection state:', pc.current?.connectionState);
        if (pc.current?.connectionState === 'connected') {
          Alert.alert('Success', 'WebRTC connection established!');
        } else if (pc.current?.connectionState === 'failed' || pc.current?.connectionState === 'closed') {
          console.log('WebRTC connection failed or closed');
          closePeerConnection();
        }
      };

      pc.current.onsignalingstatechange = () => {
        console.log('Signaling state:', pc.current?.signalingState);
      };

      pc.current.onicecandidate = (e) => {
        try {
          if (e.candidate) {
            console.log('ICE candidate:', e.candidate);
            setIceCandidatesGenerated((prev) => [...prev, e.candidate]);
            sendIceCandidates([e.candidate]);
          } else {
            console.log('No ICE candidate (null candidate)');
          }
        } catch (error) {
          console.error('Error handling ICE candidate:', error);
        }
      };
    } catch (error) {
      console.error('Error creating peer connection:', error);
      Alert.alert('Error', 'Failed to create WebRTC peer connection.');
    }
  };

  const createDataChannel = (isOfferor) => {
    try {
      if (isOfferor) {
        const dataChannelOptions = { ordered: true };
        dataChannel.current = pc.current?.createDataChannel('chat', dataChannelOptions);
        registerDataChannelEventListeners();
      } else {
        pc.current.ondatachannel = (e) => {
          console.log('Data channel received:', e);
          dataChannel.current = e.channel;
          registerDataChannelEventListeners();
        };
      }
    } catch (error) {
      console.error('Error creating data channel:', error);
      Alert.alert('Error', 'Failed to create WebRTC data channel.');
    }
  };

  const registerDataChannelEventListeners = () => {
    try {
      dataChannel.current.onmessage = (e) => {
        try {
          const msg = e.data;
          const formattedMessage = addIncomingMessageToUi(msg, otherUserId);
          setMessages((prev) => [...prev, formattedMessage]);
        } catch (error) {
          console.error('Error processing data channel message:', error);
        }
      };

      dataChannel.current.onopen = () => {
        console.log('Data channel opened');
      };

      dataChannel.current.onclose = () => {
        console.log('Data channel closed');
      };
    } catch (error) {
      console.error('Error registering data channel listeners:', error);
    }
  };

  const startWebRTCProcess = async () => {
    if (!otherUserId) {
      console.log('Cannot start WebRTC: otherUserId is null');
      return;
    }
    console.log('Starting WebRTC with otherUserId:', otherUserId);
    try {
      createPeerConnectionObject();
      createDataChannel(true);
      const offer = await pc.current?.createOffer();
      await pc.current?.setLocalDescription(offer);
      sendOffer(pc.current?.localDescription);
    } catch (error) {
      console.error('WebRTC error:', error);
      Alert.alert('Error', 'Failed to initiate WebRTC connection.');
    }
  };

  const sendOffer = (offer) => {
    try {
      if (!otherUserId) {
        console.log('Cannot send offer: otherUserId is null');
        return;
      }
      const message = {
        label: labels.WEBRTC_PROCESS,
        data: { type: type.WEB_RTC.OFFER, offer, otherUserId },
      };
      console.log('Sending offer:', message);
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending offer:', error);
    }
  };

  const sendAnswer = (answer) => {
    try {
      if (!otherUserId) {
        console.log('Cannot send answer: otherUserId is null');
        return;
      }
      const message = {
        label: labels.WEBRTC_PROCESS,
        data: { type: type.WEB_RTC.ANSWER, answer, otherUserId },
      };
      console.log('Sending answer:', message);
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending answer:', error);
    }
  };

  const sendIceCandidates = (candidates) => {
    try {
      if (!otherUserId) {
        console.log('Cannot send ICE candidates: otherUserId is null');
        return;
      }
      const message = {
        label: labels.WEBRTC_PROCESS,
        data: { type: type.WEB_RTC.ICE_CANDIDATES, candidatesArray: candidates, otherUserId },
      };
      console.log('Sending ICE candidates:', message);
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending ICE candidates:', error);
    }
  };

  const handleOffer = async (data) => {
    try {
      createPeerConnectionObject();
      createDataChannel(false);
      await pc.current?.setRemoteDescription(data.offer);
      const answer = await pc.current?.createAnswer();
      await pc.current?.setLocalDescription(answer);
      sendAnswer(answer);
    } catch (error) {
      console.error('Error handling offer:', error);
      Alert.alert('Error', 'Failed to process WebRTC offer.');
    }
  };

  const handleAnswer = async (data) => {
    try {
      await pc.current?.setRemoteDescription(data.answer);
      for (const candidate of iceCandidatesReceivedBuffer) {
        await pc.current?.addIceCandidate(candidate);
      }
      setIceCandidatesReceivedBuffer([]);
    } catch (error) {
      console.error('Error handling answer:', error);
      Alert.alert('Error', 'Failed to process WebRTC answer.');
    }
  };

  const handleIceCandidates = async (data) => {
    try {
      if (pc.current?.remoteDescription) {
        for (const candidate of data.candidatesArray) {
          await pc.current?.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } else {
        setIceCandidatesReceivedBuffer((prev) => [
          ...prev,
          ...data.candidatesArray.map((c) => new RTCIceCandidate(c)),
        ]);
      }
    } catch (error) {
      console.error('Error adding ICE candidates:', error);
    }
  };

  const sendMessageUsingDataChannel = (msg) => {
    try {
      if (dataChannel.current?.readyState === 'open') {
        dataChannel.current.send(msg);
      } else {
        console.log('Data channel not open');
        Alert.alert('Error', 'Data channel is not open');
      }
    } catch (error) {
      console.error('Error sending data channel message:', error);
      Alert.alert('Error', 'Failed to send message.');
    }
  };

  const closePeerConnection = () => {
    try {
      if (pc.current) {
        pc.current.close();
        pc.current = null;
        dataChannel.current = null;
        console.log('Peer connection closed');
      }
    } catch (error) {
      console.error('Error closing peer connection:', error);
    }
  };

  // Server Processing
  const normalServerProcessing = (data) => {
    try {
      switch (data.type) {
        case type.ROOM_CREATE.RESPONSE_SUCCESS:
          setRoomName(data.roomName);
          Alert.alert('Success', 'Room created successfully.');
          break;
        case type.ROOM_CREATE.RESPONSE_FAILURE:
          console.log('Create room failed:', data.message);
          Alert.alert('Error', data.message || 'Failed to create room.');
          break;
        case type.ROOM_JOIN.RESPONSE_SUCCESS:
          joinSuccessHandler(data);
          break;
        case type.ROOM_JOIN.RESPONSE_FAILURE:
          console.log('Join room failed:', data.message);
          Alert.alert('Error', data.message || 'Failed to join room.');
          break;
        case type.ROOM_JOIN.NOTIFY:
          console.log('Processing JOIN_ROOM_NOTIFY:', data);
          setOtherUserId(data.joinUserId);
          Alert.alert('Notification', `User ${data.joinUserId} has joined your room`);
          console.log('otherUserId after set:', otherUserId);
          console.log('data.joinUserId:', data.joinUserId);
          if (data.joinUserId) {
            console.log('Starting WebRTC for joinUserId:', data.joinUserId);
            startWebRTCProcess();
          } else {
            console.log('Cannot start WebRTC: data.joinUserId is null or undefined');
          }
          break;
        case type.ROOM_EXIT.NOTIFY:
          setOtherUserId(null);
          Alert.alert('Notification', data.message || 'A user has left your room');
          closePeerConnection();
          exitRoom();
          break;
        default:
          console.log('Unknown data type:', data.type);
      }
    } catch (error) {
      console.error('Error processing normal server message:', error);
      Alert.alert('Error', 'Failed to process server message.');
    }
  };

  const webRTCServerProcessing = (data) => {
    try {
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
          console.log('Unknown data type:', data.type);
      }
    } catch (error) {
      console.error('Error processing WebRTC message:', error);
      Alert.alert('Error', 'Failed to process WebRTC message.');
    }
  };

  const joinSuccessHandler = (data) => {
    try {
      const creatorId = data.creatorId && data.creatorId !== userId ? data.creatorId : null;
      setOtherUserId(creatorId);
      setRoomName(data.roomName);
      if (creatorId) {
        console.log('joinSuccessHandler: Starting WebRTC with creatorId:', creatorId);
        startWebRTCProcess();
      }
      Alert.alert('Success', 'Joined room successfully');
    } catch (error) {
      console.error('Error handling join success:', error);
      Alert.alert('Error', 'Failed to handle room join.');
    }
  };

  // UI Handlers
  const exitRoom = () => {
    try {
      inputRoomNameElement.current?.clear();
      setRoomName('');
      setOtherUserId(null);
      setChannelName('');
      setMessages([]);
    } catch (error) {
      console.error('Error exiting room:', error);
    }
  };

  const handleCreateRoom = () => {
    createRoom();
  };

  const handleJoinRoom = () => {
    const name = channelName.trim();
    setChannelName('');
    if (!name) {
      Alert.alert('Error', 'You have to join a room with a valid name');
      return;
    }
    joinRoom(name, userId);
  };

  const handleExitRoom = () => {
    if (roomName) {
      sendExitRoomRequest(roomName, userId);
    }
    exitRoom();
    closePeerConnection();
  };

  const handleSendMessage = () => {
    const msg = message.trim();
    setMessage('');
    if (msg) {
      const formattedMessage = addOutgoingMessageToUi(msg, userId);
      setMessages((prev) => [...prev, formattedMessage]);
      sendMessageUsingDataChannel(msg);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <Text style={styles.header}>WebRTC Chat Room (User ID: {userId})</Text>
        {/* Channel Name Input */}
        <TextInput
          ref={inputRoomNameElement}
          style={styles.input}
          placeholder="Enter room name"
          value={channelName}
          onChangeText={setChannelName}
        />
        {otherUserId !== null && <Text>Other User ID: {otherUserId}</Text>}
        {/* Buttons for Room Actions */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.button} onPress={handleCreateRoom}>
            <Text style={styles.buttonText}>Create Room</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={handleJoinRoom}>
            <Text style={styles.buttonText}>Join Room</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.button} onPress={handleExitRoom}>
            <Text style={styles.buttonText}>Exit Room</Text>
          </TouchableOpacity>
        </View>
        {/* Message Input */}
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          value={message}
          onChangeText={setMessage}
        />
        {/* Send Button */}
        <TouchableOpacity style={styles.sendButton} onPress={handleSendMessage}>
          <Text style={styles.buttonText}>Send</Text>
        </TouchableOpacity>
        {/* Message Container */}
        <View style={styles.messageContainer}>
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

// Constants
const type = {
  ROOM_CREATE: {
    RESPONSE_SUCCESS: "CHECK_ROOM_RESPONSE_SUCCESS",
    RESPONSE_FAILURE: "CHECK_ROOM_RESPONSE_FAILURE",
  },
  ROOM_JOIN: {
    REQUEST: "JOIN_ROOM_REQUEST",
    RESPONSE_SUCCESS: "JOIN_ROOM_RESPONSE_SUCCESS",
    RESPONSE_FAILURE: "JOIN_ROOM_RESPONSE_FAILURE",
    NOTIFY: "JOIN_ROOM_NOTIFY",
  },
  ROOM_EXIT: {
    REQUEST: "EXIT_ROOM_REQUEST",
    NOTIFY: "EXIT_ROOM_NOTIFY",
  },
  WEB_RTC: {
    OFFER: "OFFER",
    ANSWER: "ANSWER",
    ICE_CANDIDATES: "ICE_CANDIDATES",
  },
};

const labels = {
  NORMAL_SERVER_PROCESS: "NORMAL_SERVER_PROCESS",
  WEBRTC_PROCESS: "WEBRTC_PROCESS",
};

const webRTCConfiguratons = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302',
      ],
    },
  ],
};

// Utility Functions
const addOutgoingMessageToUi = (message, userId) => `${userId}: ${message}`;
const addIncomingMessageToUi = (message, otherUserId) => `${otherUserId}: ${message}`;

const App = () => {
  // State
  const [userId] = useState(Math.round(Math.random() * 1000000).toString());
  const [roomName, setRoomName] = useState('');
  const [otherUserId, setOtherUserId] = useState(null);
  const [channelName, setChannelName] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [iceCandidatesGenerated, setIceCandidatesGenerated] = useState([]);
  const [iceCandidatesReceivedBuffer, setIceCandidatesReceivedBuffer] = useState([]);

  // Refs
  const pc = useRef(null);
  const dataChannel = useRef(null);
  const wsConnection = useRef(null);
  const inputRoomNameElement = useRef(null);

  // WebSocket Setup and Cleanup

   
  useEffect(()=>{
    startWebRTCProcess();
  },[otherUserId]);
  useEffect(() => {
    const connectWebSocket = () => {
      try {
        wsConnection.current = new WebSocket(`ws://10.0.2.2:8080/?userId=${userId}`);

        wsConnection.current.onopen = () => {
          console.log('Connected to WebSocket server');
        };

        wsConnection.current.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            console.log('Received message:', message);
            switch (message.label) {
              case labels.NORMAL_SERVER_PROCESS:
                normalServerProcessing(message.data);
                break;
              case labels.WEBRTC_PROCESS:
                webRTCServerProcessing(message.data);
                break;
              default:
                console.log('Unknown server processing label:', message.label);
            }
          } catch (error) {
            console.error('Error processing WebSocket message:', error);
            Alert.alert('Error', 'Failed to process server message.');
          }
        };

        wsConnection.current.onclose = () => {
          console.log('Disconnected from WebSocket server');
          Alert.alert('Info', 'Disconnected from server. Retrying...');
          setTimeout(connectWebSocket, 10000);
        };

        wsConnection.current.onerror = (error) => {
          console.error('WebSocket error:', error);
          Alert.alert('Error', 'Failed to connect to WebSocket server. Retrying...');
        };
      } catch (error) {
        console.error('WebSocket setup error:', error);
        Alert.alert('Error', 'Failed to initialize WebSocket connection.');
      }
    };

    connectWebSocket();

    return () => {
      try {
        wsConnection.current?.close();
      } catch (error) {
        console.error('Error closing WebSocket:', error);
      }
    };
  }, [userId]);

  // Room Management
  const createRoom = () => {
    const name = channelName.trim();
    setChannelName('');
    if (!name) {
      Alert.alert('Error', 'Your room needs a name');
      return;
    }
    try {
      const message = {
        label: labels.NORMAL_SERVER_PROCESS,
        data: {
          type: type.ROOM_CREATE.RESPONSE_SUCCESS,
          roomName: name,
          userId,
        },
      };
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error creating room:', error);
      Alert.alert('Error', 'Failed to create room.');
    }
  };

  const joinRoom = (name, id) => {
    try {
      const message = {
        label: labels.NORMAL_SERVER_PROCESS,
        data: {
          type: type.ROOM_JOIN.REQUEST,
          roomName: name,
          userId: id,
        },
      };
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error joining room:', error);
      Alert.alert('Error', 'Failed to join room.');
    }
  };

  const sendExitRoomRequest = (name, id) => {
    try {
      const message = {
        label: labels.NORMAL_SERVER_PROCESS,
        data: {
          type: type.ROOM_EXIT.REQUEST,
          roomName: name,
          userId: id,
        },
      };
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending exit room request:', error);
      Alert.alert('Error', 'Failed to exit room.');
    }
  };

  // WebRTC Functions
  const createPeerConnectionObject = () => {
    try {
      pc.current = new RTCPeerConnection(webRTCConfiguratons);

      pc.current.onconnectionstatechange = () => {
        console.log('Connection state:', pc.current?.connectionState);
        if (pc.current?.connectionState === 'connected') {
          Alert.alert('Success', 'WebRTC connection established!');
        } else if (pc.current?.connectionState === 'failed' || pc.current?.connectionState === 'closed') {
          console.log('WebRTC connection failed or closed');
          closePeerConnection();
        }
      };

      pc.current.onsignalingstatechange = () => {
        console.log('Signaling state:', pc.current?.signalingState);
      };

      pc.current.onicecandidate = (e) => {
        try {
          if (e.candidate) {
            console.log('ICE candidate:', e.candidate);
            setIceCandidatesGenerated((prev) => [...prev, e.candidate]);
            sendIceCandidates([e.candidate]);
          } else {
            console.log('No ICE candidate (null candidate)');
          }
        } catch (error) {
          console.error('Error handling ICE candidate:', error);
        }
      };
    } catch (error) {
      console.error('Error creating peer connection:', error);
      Alert.alert('Error', 'Failed to create WebRTC peer connection.');
    }
  };

  const createDataChannel = (isOfferor) => {
    try {
      if (isOfferor) {
        const dataChannelOptions = { ordered: true };
        dataChannel.current = pc.current?.createDataChannel('chat', dataChannelOptions);
        registerDataChannelEventListeners();
      } else {
        pc.current.ondatachannel = (e) => {
          console.log('Data channel received:', e);
          dataChannel.current = e.channel;
          registerDataChannelEventListeners();
        };
      }
    } catch (error) {
      console.error('Error creating data channel:', error);
      Alert.alert('Error', 'Failed to create WebRTC data channel.');
    }
  };

  const registerDataChannelEventListeners = () => {
    try {
      dataChannel.current.onmessage = (e) => {
        try {
          const msg = e.data;
          const formattedMessage = addIncomingMessageToUi(msg, otherUserId);
          setMessages((prev) => [...prev, formattedMessage]);
        } catch (error) {
          console.error('Error processing data channel message:', error);
        }
      };

      dataChannel.current.onopen = () => {
        console.log('Data channel opened');
      };

      dataChannel.current.onclose = () => {
        console.log('Data channel closed');
      };
    } catch (error) {
      console.error('Error registering data channel listeners:', error);
    }
  };

  const startWebRTCProcess = async () => {
    if (!otherUserId) {
      console.log('Cannot start WebRTC: otherUserId is null');
      return;
    }
    console.log('Starting WebRTC with otherUserId:', otherUserId);
    try {
      createPeerConnectionObject();
      createDataChannel(true);
      const offer = await pc.current?.createOffer();
      await pc.current?.setLocalDescription(offer);
      sendOffer(pc.current?.localDescription);
    } catch (error) {
      console.error('WebRTC error:', error);
      Alert.alert('Error', 'Failed to initiate WebRTC connection.');
    }
  };

  const sendOffer = (offer) => {
    try {
      if (!otherUserId) {
        console.log('Cannot send offer: otherUserId is null');
        return;
      }
      const message = {
        label: labels.WEBRTC_PROCESS,
        data: { type: type.WEB_RTC.OFFER, offer, otherUserId },
      };
      console.log('Sending offer:', message);
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending offer:', error);
    }
  };

  const sendAnswer = (answer) => {
    try {
      if (!otherUserId) {
        console.log('Cannot send answer: otherUserId is null');
        return;
      }
      const message = {
        label: labels.WEBRTC_PROCESS,
        data: { type: type.WEB_RTC.ANSWER, answer, otherUserId },
      };
      console.log('Sending answer:', message);
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending answer:', error);
    }
  };

  const sendIceCandidates = (candidates) => {
    try {
      if (!otherUserId) {
        console.log('Cannot send ICE candidates: otherUserId is null');
        return;
      }
      const message = {
        label: labels.WEBRTC_PROCESS,
        data: { type: type.WEB_RTC.ICE_CANDIDATES, candidatesArray: candidates, otherUserId },
      };
      console.log('Sending ICE candidates:', message);
      wsConnection.current?.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending ICE candidates:', error);
    }
  };

  const handleOffer = async (data) => {
    try {
      createPeerConnectionObject();
      createDataChannel(false);
      await pc.current?.setRemoteDescription(data.offer);
      const answer = await pc.current?.createAnswer();
      await pc.current?.setLocalDescription(answer);
      sendAnswer(answer);
    } catch (error) {
      console.error('Error handling offer:', error);
      Alert.alert('Error', 'Failed to process WebRTC offer.');
    }
  };

  const handleAnswer = async (data) => {
    try {
      await pc.current?.setRemoteDescription(data.answer);
      for (const candidate of iceCandidatesReceivedBuffer) {
        await pc.current?.addIceCandidate(candidate);
      }
      setIceCandidatesReceivedBuffer([]);
    } catch (error) {
      console.error('Error handling answer:', error);
      Alert.alert('Error', 'Failed to process WebRTC answer.');
    }
  };

  const handleIceCandidates = async (data) => {
    try {
      if (pc.current?.remoteDescription) {
        for (const candidate of data.candidatesArray) {
          await pc.current?.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } else {
        setIceCandidatesReceivedBuffer((prev) => [
          ...prev,
          ...data.candidatesArray.map((c) => new RTCIceCandidate(c)),
        ]);
      }
    } catch (error) {
      console.error('Error adding ICE candidates:', error);
    }
  };

  const sendMessageUsingDataChannel = (msg) => {
    try {
      if (dataChannel.current?.readyState === 'open') {
        dataChannel.current.send(msg);
      } else {
        console.log('Data channel not open');
        Alert.alert('Error', 'Data channel is not open');
      }
    } catch (error) {
      console.error('Error sending data channel message:', error);
      Alert.alert('Error', 'Failed to send message.');
    }
  };

  const closePeerConnection = () => {
    try {
      if (pc.current) {
        pc.current.close();
        pc.current = null;
        dataChannel.current = null;
        console.log('Peer connection closed');
      }
    } catch (error) {
      console.error('Error closing peer connection:', error);
    }
  };

  // Server Processing
  const normalServerProcessing = (data) => {
    try {
      switch (data.type) {
        case type.ROOM_CREATE.RESPONSE_SUCCESS:
          setRoomName(data.roomName);
          Alert.alert('Success', 'Room created successfully.');
          break;
        case type.ROOM_CREATE.RESPONSE_FAILURE:
          console.log('Create room failed:', data.message);
          Alert.alert('Error', data.message || 'Failed to create room.');
          break;
        case type.ROOM_JOIN.RESPONSE_SUCCESS:
          joinSuccessHandler(data);
          break;
        case type.ROOM_JOIN.RESPONSE_FAILURE:
          console.log('Join room failed:', data.message);
          Alert.alert('Error', data.message || 'Failed to join room.');
          break;
        case type.ROOM_JOIN.NOTIFY:
          setOtherUserId((otherUserId)=>data.joinUserId);
          console.log(otherUserId);
          Alert.alert('Notification', `User ${data.joinUserId} has joined your room`);
          console.log("Hello control is here.");
          if (otherUserId) { 
            console.log('Hello control is here.');
            startWebRTCProcess();
          } else {
            console.log('Cannot start WebRTC: data.joinUserId is null or undefined');
          }
          break;
        case type.ROOM_EXIT.NOTIFY:
          setOtherUserId(null);
          Alert.alert('Notification', data.message || 'A user has left your room');
          closePeerConnection();
          exitRoom();
          break;
        default:
          console.log('Unknown data type:', data.type);
      }
    } catch (error) {
      console.error('Error processing normal server message:', error);
      Alert.alert('Error', 'Failed to process server message.');
    }
  };

  const webRTCServerProcessing = (data) => {
    try {
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
          console.log('Unknown data type:', data.type);
      }
    } catch (error) {
      console.error('Error processing WebRTC message:', error);
      Alert.alert('Error', 'Failed to process WebRTC message.');
    }
  };

  const joinSuccessHandler = (data) => {
    try {
      const creatorId = data.creatorId && data.creatorId !== userId ? data.creatorId : null;
      setOtherUserId(creatorId);
      setRoomName(data.roomName);
      if (creatorId) {
        console.log('joinSuccessHandler: Starting WebRTC with creatorId:', creatorId);
      }
      Alert.alert('Success', 'Joined room successfully');
    } catch (error) {
      console.error('Error handling join success:', error);
      Alert.alert('Error', 'Failed to handle room join.');
    }
  };

  // UI Handlers
  const exitRoom = () => {
    try {
      inputRoomNameElement.current?.clear();
      setRoomName('');
      setOtherUserId(null);
      setChannelName('');
      setMessages([]);
    } catch (error) {
      console.error('Error exiting room:', error);
    }
  };

  const handleCreateRoom = () => {
    createRoom();
  };

  const handleJoinRoom = () => {
    const name = channelName.trim();
    setChannelName('');
    if (!name) {
      Alert.alert('Error', 'You have to join a room with a valid name');
      return;
    }
    joinRoom(name, userId);
  };

  const handleExitRoom = () => {
    if (roomName) {
      sendExitRoomRequest(roomName, userId);
    }
    exitRoom();
    closePeerConnection();
  };

  const handleSendMessage = () => {
    const msg = message.trim();
    setMessage('');
    if (msg) {
      const formattedMessage = addOutgoingMessageToUi(msg, userId);
      setMessages((prev) => [...prev, formattedMessage]);
      sendMessageUsingDataChannel(msg);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <Text style={styles.header}>WebRTC Chat Room (User ID: {userId})</Text>
        {/* Channel Name Input */}
        <TextInput
          ref={inputRoomNameElement}
          style={styles.input}
          placeholder="Enter room name"
          value={channelName}
          onChangeText={setChannelName}
        />
        {
        otherUserId!==null && <Text>{otherUserId}</Text>
        }
        {/* Buttons for Room Actions */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.button} onPress={handleCreateRoom}>
            <Text style={styles.buttonText}>Create Room</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={handleJoinRoom}>
            <Text style={styles.buttonText}>Join Room</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.button} onPress={handleExitRoom}>
            <Text style={styles.buttonText}>Exit Room</Text>
          </TouchableOpacity>
        </View>

        {/* Message Input */}
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          value={message}
          onChangeText={setMessage}
        />

        {/* Send Button */}
        <TouchableOpacity style={styles.sendButton} onPress={handleSendMessage}>
          <Text style={styles.buttonText}>Send</Text>
        </TouchableOpacity>

        {/* Message Container */}
        <View style={styles.messageContainer}>
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

































node app.js 
WebSocket server running on ws://localhost:8080
User 9148 connected
User 58159 connected
User 58159 connected
User 58159 disconnected
User 58159 connected
Received: {
  label: 'NORMAL_SERVER_PROCESS',
  data: {
    type: 'CHECK_ROOM_RESPONSE_SUCCESS',
    roomName: 'satyam',
    userId: '9148'
  }
}
Room satyam created by 9148
Received: {
  label: 'NORMAL_SERVER_PROCESS',
  data: { type: 'JOIN_ROOM_REQUEST', roomName: 'satyam', userId: '58159' }
}
User 58159 joined room satyam
User 9148 disconnected
User 9148 disconnected from room satyam
Received: {
  label: 'WEBRTC_PROCESS',
  data: {
    type: 'OFFER',
    offer: {
      type: 'offer',
      sdp: 'v=0\r\n' +
        'o=- 3106194208108687564 2 IN IP4 127.0.0.1\r\n' +
        's=-\r\n' +
        't=0 0\r\n' +
        'a=group:BUNDLE 0\r\n' +
        'a=extmap-allow-mixed\r\n' +
        'a=msid-semantic: WMS\r\n' +
        'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n' +
        'c=IN IP4 0.0.0.0\r\n' +
        'a=ice-ufrag:lLHg\r\n' +
        'a=ice-pwd:O+SnlMf065ABb8/GfF1vUEC+\r\n' +
        'a=ice-options:trickle\r\n' +
        'a=fingerprint:sha-256 42:D9:2F:A0:CC:3A:CA:84:C4:88:42:B4:D4:45:B9:0A:B0:B2:2D:E0:86:4A:70:11:81:FB:4B:11:8C:51:7D:48\r\n' +
        'a=setup:actpass\r\n' +
        'a=mid:0\r\n' +
        'a=sctp-port:5000\r\n' +
        'a=max-message-size:262144\r\n'
    },
    otherUserId: '9148'
  }
}
Target user 9148 not found for WebRTC message from 58159
Received: {
  label: 'WEBRTC_PROCESS',
  data: {
    type: 'ICE_CANDIDATES',
    candidatesArray: [ [Object] ],
    otherUserId: '9148'
  }
}
Target user 9148 not found for WebRTC message from 58159
