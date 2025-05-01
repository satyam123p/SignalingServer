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
    RESPONSE_FAILURE: 'CHECK_ROOM_RESPONSE_FAILURE',
    RESPONSE_SUCCESS: 'CHECK_ROOM_RESPONSE_SUCCESS',
  },
  ROOM_DESTROY: {
    RESPONSE_FAILURE: 'DESTROY_ROOM_RESPONSE_FAILURE',
    RESPONSE_SUCCESS: 'DESTROY_ROOM_RESPONSE_SUCCESS',
  },
  ROOM_JOIN: {
    RESPONSE_FAILURE: 'JOIN_ROOM_RESPONSE_FAILURE',
    RESPONSE_SUCCESS: 'JOIN_ROOM_RESPONSE_SUCCESS',
    REQUEST: 'JOIN_ROOM_REQUEST',
    NOTIFY: 'JOIN_ROOM_NOTIFY',
  },
  ROOM_EXIT: {
    REQUEST: 'EXIT_ROOM_REQUEST',
    NOTIFY: 'EXIT_ROOM_NOTIFY',
  },
  ROOM_DISONNECTION: {
    NOTIFY: 'DISCONNECT_ROOM_NOTIFICATION',
  },
  WEB_RTC: {
    OFFER: 'OFFER',
    ANSWER: 'ANSWER',
    ICE_CANDIDATES: 'ICE_CANDIDATES',
  },
};

const labels = {
  NORMAL_SERVER_PROCESS: 'NORMAL_SERVER_PROCESS',
  WEBRTC_PROCESS: 'WEBRTC_PROCESS',
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
    wsConnection.current = new WebSocket(`ws://10.0.2.2:8080/?userId=${userId}`);

    wsConnection.current.onopen = () => {
      console.log('Connected to WebSocket server');
    };

    wsConnection.current.onmessage = (event) => {
      const message = JSON.parse(event.data);
      switch (message.label) {
        case labels.NORMAL_SERVER_PROCESS:
          normalServerProcessing(message.data);
          break;
        case labels.WEBRTC_PROCESS:
          webRTCServerProcessing(message.data);
          break;
        default:
          console.log('Unknown server processing label: ', message.label);
      }
    };

    wsConnection.current.onclose = () => {
      console.log('Disconnected from WebSocket server');
    };

    wsConnection.current.onerror = () => {
      console.log('WebSocket error');
    };

    return () => {
      wsConnection.current?.close();
    };
  }, [userId]);

  // Room Management
  const createRoom = async (name, id) => {
    try {
      const response = await fetch('http://10.0.2.2:8080/create-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: name, userId: id }),
      });
      const resObj = await response.json();
      if (resObj.data.type === type.ROOM_CREATE.RESPONSE_SUCCESS) {
        setRoomName(name);
        Alert.alert('Success', 'Room created successfully.');
      } else {
        console.log('Create Room Failure:', resObj.data.message);
      }
    } catch (err) {
      console.log('Error creating room:', err);
    }
  };

  const destroyRoom = async (name) => {
    try {
      const response = await fetch('http://10.0.2.2:8080/destroy-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: name }),
      });
      const resObj = await response.json();
      if (resObj.data.type === type.ROOM_DESTROY.RESPONSE_SUCCESS) {
        exitRoom();
      } else {
        console.log('Destroy Room Failure:', resObj.data.message);
      }
    } catch (err) {
      console.log('Error destroying room:', err);
    }
  };

  const joinRoom = (name, id) => {
    const message = {
      label: labels.NORMAL_SERVER_PROCESS,
      data: { type: type.ROOM_JOIN.RESPONSE_SUCCESS, roomName: name, userId: id },
    };
    wsConnection.current?.send(JSON.stringify(message));
  };

  const sendExitRoomRequest = (name, id) => {
    const message = {
      label: labels.NORMAL_SERVER_PROCESS,
      data: { type: type.ROOM_EXIT.REQUEST, roomName: name, userId: id },
    };
    wsConnection.current?.send(JSON.stringify(message));
  };

  // WebRTC Functions
  const createPeerConnectionObject = () => {
    pc.current = new RTCPeerConnection(webRTCConfiguratons);

    pc.current.onconnectionstatechange = () => {
      console.log('Connection state:', pc.current?.connectionState);
      if (pc.current?.connectionState === 'connected') {
        Alert.alert('Success', 'WebRTC connection established!');
      }
    };

    pc.current.onsignalingstatechange = () => {
      console.log('Signaling state:', pc.current?.signalingState);
    };

    pc.current.onicecandidate = (e) => {
      if (e.candidate) {
        console.log('ICE candidate:', e.candidate);
        setIceCandidatesGenerated((prev) => [...prev, e.candidate]);
      }
    };
  };

  const createDataChannel = (isOfferor) => {
    if (isOfferor) {
      const dataChannelOptions = { ordered: false, maxRetransmits: 0 };
      dataChannel.current = pc.current?.createDataChannel('top-secret-chat-room', dataChannelOptions);
      registerDataChannelEventListeners();
    } else {
      pc.current.ondatachannel = (e) => {
        console.log('Data channel received:', e);
        dataChannel.current = e.channel;
        registerDataChannelEventListeners();
      };
    }
  };

  const registerDataChannelEventListeners = () => {
    dataChannel.current.onmessage = (e) => {
      const msg = e.data;
      const formattedMessage = addIncomingMessageToUi(msg, otherUserId);
      setMessages((prev) => [...prev, formattedMessage]);
    };

    dataChannel.current.onopen = () => {
      console.log('Data channel opened');
    };

    dataChannel.current.onclose = () => {
      console.log('Data channel closed');
    };
  };

  const startWebRTCProcess = async () => {
    createPeerConnectionObject();
    createDataChannel(true);

    try {
      const offer = await pc.current?.createOffer();
      await pc.current?.setLocalDescription(offer);
      sendOffer(pc.current?.localDescription);
    } catch (error) {
      console.error('WebRTC error:', error);
    }
  };

  const sendOffer = (offer) => {
    const message = {
      label: labels.WEBRTC_PROCESS,
      data: { type: type.WEB_RTC.OFFER, offer, otherUserId },
    };
    wsConnection.current?.send(JSON.stringify(message));
  };

  const sendAnswer = (answer) => {
    const message = {
      label: labels.WEBRTC_PROCESS,
      data: { type: type.WEB_RTC.ANSWER, answer, otherUserId },
    };
    wsConnection.current?.send(JSON.stringify(message));
  };

  const sendIceCandidates = (candidates) => {
    const message = {
      label: labels.WEBRTC_PROCESS,
      data: { type: type.WEB_RTC.ICE_CANDIDATES, candidatesArray: candidates, otherUserId },
    };
    wsConnection.current?.send(JSON.stringify(message));
  };

  const handleOffer = async (data) => {
    createPeerConnectionObject();
    createDataChannel(false);
    await pc.current?.setRemoteDescription(data.offer);
    const answer = await pc.current?.createAnswer();
    await pc.current?.setLocalDescription(answer);
    sendAnswer(answer);
    sendIceCandidates(iceCandidatesGenerated);
  };

  const handleAnswer = async (data) => {
    sendIceCandidates(iceCandidatesGenerated);
    await pc.current?.setRemoteDescription(data.answer);
    for (const candidate of iceCandidatesReceivedBuffer) {
      await pc.current?.addIceCandidate(candidate);
    }
    setIceCandidatesReceivedBuffer([]);
  };

  const handleIceCandidates = (data) => {
    if (pc.current?.remoteDescription) {
      try {
        data.candidatesArray.forEach((candidate) => {
          pc.current?.addIceCandidate(new RTCIceCandidate(candidate));
        });
      } catch (error) {
        console.log('Error adding ICE candidate:', error);
      }
    } else {
      setIceCandidatesReceivedBuffer((prev) => [...prev, ...data.candidatesArray.map(c => new RTCIceCandidate(c))]);
    }
  };

  const sendMessageUsingDataChannel = (msg) => {
    dataChannel.current?.send(msg);
  };

  const closePeerConnection = () => {
    if (pc.current) {
      pc.current.close();
      pc.current = null;
      dataChannel.current = null;
      console.log('Peer connection closed');
    }
  };

  // Server Processing
  const normalServerProcessing = (data) => {
    switch (data.type) {
      case type.ROOM_JOIN.RESPONSE_SUCCESS:
        setOtherUserId(data.creatorId);
        setRoomName(data.roomName);
        startWebRTCProcess();
        Alert.alert('Success', 'Join room successful');
        break;
      case type.ROOM_JOIN.RESPONSE_FAILURE:
        console.log('Join room failed');
        break;
      case type.ROOM_JOIN.NOTIFY:
        setOtherUserId(data.joinUserId);
        Alert.alert('Notification', `User ${data.joinUserId} has joined your room`);
        break;
      case type.ROOM_EXIT.NOTIFY:
      case type.ROOM_DISONNECTION.NOTIFY:
        setOtherUserId(null);
        Alert.alert('Notification', 'A user has left your room');
        closePeerConnection();
        break;
      default:
        console.log('Unknown data type:', data.type);
    }
  };

  const webRTCServerProcessing = (data) => {
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
  };

  // UI Handlers
  const exitRoom = () => {
    inputRoomNameElement.current?.clear();
    setRoomName('');
    setOtherUserId(null);
    setChannelName('');
  };

  const handleCreateRoom = () => {
    const name = channelName.trim();
    setChannelName('');
    if (!name) {
      Alert.alert('Error', 'Your room needs a name');
      return;
    }
    createRoom(name, userId);
  };

  const handleDestroyRoom = () => {
    if (roomName) {
      destroyRoom(roomName);
    }
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
          <TouchableOpacity style={styles.button} onPress={handleCreateRoom}>
            <Text style={styles.buttonText}>Create</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={handleJoinRoom}>
            <Text style={styles.buttonText}>Join</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.button} onPress={handleDestroyRoom}>
            <Text style={styles.buttonText}>Destroy Room</Text>
          </TouchableOpacity>
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









import json
from http import HTTPStatus
from response_service import ResponseService, RESPONSE_CODES

def lambda_handler(event, context):
    try:
        # Instantiate ResponseService with event and context
        response_service = ResponseService(event=event, context=context, is_ecs=False)
        
        # Example: Create a sample OK response
        response_body = {"message": "Hello from Lambda!"}
        response = response_service.create_ok_http_response(response_body)
        
        return response
    
    except Exception as e:
        # Handle errors using ResponseService
        response_service = ResponseService(event=event, context=context, is_ecs=False)
        error_response = response_service.create_error_http_response(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            error_object=e,
            body={"error": str(e)}
        )
        return error_response






import json
import logging
from http import HTTPStatus
from typing import Any, Dict, List, Optional, Union
from datetime import datetime
from threading import Lock

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler()]
)

# Define response codes
class ResponseCodes:
    OK = {"CODE": "OK", "MESSAGE": "Success"}
    UNKNOWN = {"CODE": "UNKNOWN", "MESSAGE": "Unknown error"}
    INVALID_PARAMETER_VALUE = {"CODE": "INVALID_PARAMETER_VALUE", "MESSAGE": "Invalid parameter value"}

RESPONSE_CODES = ResponseCodes()

class ResponseService:
    _instance = None
    _lock = Lock()

    def __init__(self, event: Optional[Dict] = None, context: Any = None, is_ecs: Union[str, bool] = False):
        self.logger = logging.getLogger(__name__)

        if isinstance(is_ecs, str):
            is_ecs = is_ecs.lower() == 'true'
        elif not isinstance(is_ecs, bool):
            self.logger.warning(f"Invalid is_ecs type: {type(is_ecs)}. Defaulting to False.")
            is_ecs = False
        self.is_ecs = is_ecs

        event = event or {}
        context = context or type('Context', (), {'functionName': ''})()
        headers = {k.lower(): v for k, v in event.get('headers', {}).items()}

        self.function_name = getattr(context, 'functionName', '')
        if not self.function_name and not is_ecs:
            self.logger.warning("Context object missing functionName attribute")
        self.requested_time = headers.get('requestedtime', int(datetime.now().timestamp() * 1000))
        self.requested_id = headers.get('requestedid', '')
        self.start = int(datetime.now().timestamp() * 1000)
        self.cold_start = True
        self.cookie = headers.get('cookie', '')

        if is_ecs:
            self._initialize_ecs(event, context, headers)
        else:
            self._initialize_non_ecs(event, headers)

        if not is_ecs:
            with self._lock:
                if not ResponseService._instance:
                    ResponseService._instance = self
                else:
                    self._update_instance(event, headers)
                return

    def _initialize_ecs(self, event: Dict, context: Any, headers: Dict):
        self.res = context
        self.body = event.get('body', '')
        self.query_string_parameters = event.get('query', {})
        self.path_parameters = event.get('params', {})
        self.headers = {
            'Content-Type': headers.get('content-type', 'application/json'),
            'X-Frame-Options': 'SAMEORIGIN',
            'functionName': self.function_name,
            'start': self.start,
            'requestedTime': self.requested_time,
            'requestedId': self.requested_id,
        }

    def _initialize_non_ecs(self, event: Dict, headers: Dict):
        try:
            self.body = self._get_parsed_body_from_event(event.get('body', '')) if event.get('body') else ''
        except Exception as e:
            self.logger.error(f"Error parsing body: {str(e)}")
            self.body = ''

        self.query_string_parameters = event.get('queryStringParameters', {})
        self.path_parameters = event.get('pathParameters', {})
        self.headers = {
            'Content-Type': headers.get('content-type', 'application/json'),
            'X-Frame-Options': 'SAMEORIGIN',
            'functionName': self.function_name,
            'start': self.start,
            'requestedTime': self.requested_time,
            'requestedId': self.requested_id,
            'coldStart': self.cold_start,
        }

    def _update_instance(self, event: Dict, headers: Dict):
        instance = ResponseService._instance
        instance.requested_id = headers.get('requestedid', '')
        instance.requested_time = headers.get('requestedtime', int(datetime.now().timestamp() * 1000))
        instance.start = int(datetime.now().timestamp() * 1000)
        instance.cold_start = False
        instance.headers.update({
            'Content-Type': headers.get('content-type', 'application/json'),
            'requestedId': instance.requested_id,
            'requestedTime': instance.requested_time,
            'start': instance.start,
            'coldStart': instance.cold_start,
        })
        instance.query_string_parameters = event.get('queryStringParameters', {})
        instance.path_parameters = event.get('pathParameters', {})
        instance.body = self._get_parsed_body_from_event(event.get('body', '')) if event.get('body') else ''

    def _get_parsed_body_from_event(self, body: Union[str, Dict]) -> Any:
        try:
            if isinstance(body, str):
                if not body.strip():
                    return {}
                return json.loads(body)
            return body
        except json.JSONDecodeError as e:
            self.logger.error(f"[COMMON][ERROR][getParsedBodyFromEvent] {str(e)}")
            raise self._handle_error('INVALID_PARAMETER_VALUE', f"Unable to Parse JSON Body [{body}]")

    def add_custom_response(self, code: Optional[Dict], params: Dict, response_body: Optional[Dict] = None) -> Dict:
        response_body = response_body or {}
        if code:
            response_body['resultMessage'] = code['MESSAGE'] + (f" ({params['message']})" if params.get('message') else '')
            response_body['resultCode'] = code['CODE']
        else:
            message = RESPONSE_CODES.UNKNOWN['MESSAGE']
            if params.get('type'):
                message += f" [{params['type']}]"
            if params.get('message'):
                message += f" ({params['message']})"
            response_body['resultMessage'] = message
            response_body['resultCode'] = RESPONSE_CODES.UNKNOWN['CODE']
        return response_body

    def create_response(self, status_code: int, response_body: Any, headers: Optional[Dict] = None, is_base64_encoded: bool = False) -> Union[None, Dict]:
        headers = headers or {}
        need_stringify = isinstance(response_body, (dict, list))

        if self.is_ecs:
            updated_headers = {
                **self.headers,
                **headers,
                'end': int(datetime.now().timestamp() * 1000),
                'ecs': True,
            }
            for key, value in updated_headers.items():
                self.res.headers[key] = value
            self.res.status_code = status_code
            self.res.set_data(json.dumps(response_body) if need_stringify else response_body)
            return self.res
        else:
            self.headers['end'] = int(datetime.now().timestamp() * 1000)
            return {
                'statusCode': status_code,
                'headers': {**self.headers, **headers},
                'body': json.dumps(response_body) if need_stringify else response_body,
                'isBase64Encoded': is_base64_encoded,
            }

    def create_ok_http_response(self, response_body: Any) -> Union[None, Dict]:
        response_body = self.add_custom_response(RESPONSE_CODES.OK, {}, response_body)
        return self.create_response(HTTPStatus.OK, response_body)

    def create_created_http_response(self, object_id: Any = None, api_path: Optional[str] = None) -> Union[None, Dict]:
        response = {'id': object_id, 'href': api_path} if object_id is not None and api_path is not None else {}
        return self.create_response(HTTPStatus.CREATED, response)

    def create_error_http_response(self, status_code: int, error_object: Exception, body: Optional[Dict] = None) -> Union[None, Dict]:
        self.logger.error(f"[{status_code}] {str(error_object)}")
        code_obj = getattr(RESPONSE_CODES, getattr(error_object, 'name', 'UNKNOWN'), RESPONSE_CODES.UNKNOWN)
        response_body = self.add_custom_response(
            code_obj,
            {'type': getattr(error_object, 'name', 'UNKNOWN'), 'message': str(error_object)},
            body
        )
        return self.create_response(status_code, response_body)

    def _handle_error(self, error_type: str, error_message: str) -> Exception:
        error = Exception(error_message)
        setattr(error, 'name', error_type)
        return error

    def add_header(self, key: str, value: Any):
        self.headers[key] = value

    def append_header(self, key: str, value: Any):
        if key in self.headers:
            self.headers[key] = f"{self.headers[key]};{value}"
        else:
            self.headers[key] = value






import json
import logging
from http import HTTPStatus
from typing import Any, Dict, List, Optional, Union
from datetime import datetime
from threading import Lock

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler()]
)

# Define response codes
class ResponseCodes:
    OK = {"CODE": "OK", "MESSAGE": "Success"}
    UNKNOWN = {"CODE": "UNKNOWN", "MESSAGE": "Unknown error"}
    INVALID_PARAMETER_VALUE = {"CODE": "INVALID_PARAMETER_VALUE", "MESSAGE": "Invalid parameter value"}
    # Add other codes from common-const.js as needed

RESPONSE_CODES = ResponseCodes()

class ResponseService:
    _instance = None
    _lock = Lock()

    def __init__(self, event: Optional[Dict] = None, context: Any = None, is_ecs: Union[str, bool] = False):
        self.logger = logging.getLogger(__name__)

        # Validate is_ecs
        if isinstance(is_ecs, str):
            is_ecs = is_ecs.lower() == 'true'
        elif not isinstance(is_ecs, bool):
            self.logger.warning(f"Invalid is_ecs type: {type(is_ecs)}. Defaulting to False.")
            is_ecs = False
        self.is_ecs = is_ecs

        event = event or {}
        context = context or type('Context', (), {'functionName': ''})()
        headers = event.get('headers', {})

        # Initialize common attributes
        self.function_name = getattr(context, 'functionName', '')
        if not self.function_name and not is_ecs:
            self.logger.warning("Context object missing functionName attribute")
        self.requested_time = headers.get('requestedtime', int(datetime.now().timestamp() * 1000))
        self.requested_id = headers.get('requestedid', '')
        self.start = int(datetime.now().timestamp() * 1000)
        self.cold_start = True
        self.cookie = headers.get('Cookie', '')

        if is_ecs:
            self._initialize_ecs(event, context, headers)
        else:
            self._initialize_non_ecs(event, headers)

        # Singleton pattern for non-ECS
        if not is_ecs:
            with self._lock:
                if not ResponseService._instance:
                    ResponseService._instance = self
                else:
                    self._update_instance(event, headers)
                return ResponseService._instance

    def _initialize_ecs(self, event: Dict, context: Any, headers: Dict):
        self.res = context  # Framework-specific response object (e.g., Flask Response)
        self.body = event.get('body', '')
        self.query_string_parameters = event.get('query', {})
        self.path_parameters = event.get('params', {})
        self.headers = {
            'Content-Type': headers.get('content-type', 'application/json'),
            'X-Frame-Options': 'SAMEORIGIN',
            'functionName': self.function_name,
            'start': self.start,
            'requestedTime': self.requested_time,
            'requestedId': self.requested_id,
        }

    def _initialize_non_ecs(self, event: Dict, headers: Dict):
        try:
            self.body = self._get_parsed_body_from_event(event.get('body', '')) if event.get('body') else ''
        except Exception as e:
            self.logger.error(f"Error parsing body: {str(e)}")
            self.body = ''
        
        self.query_string_parameters = event.get('queryStringParameters', {})
        self.path_parameters = event.get('pathParameters', {})
        self.headers = {
            'Content-Type': headers.get('content-type', 'application/json'),
            'X-Frame-Options': 'SAMEORIGIN',
            'functionName': self.function_name,
            'start': self.start,
            'requestedTime': self.requested_time,
            'requestedId': self.requested_id,
            'coldStart': self.cold_start,
        }

    def _update_instance(self, event: Dict, headers: Dict):
        instance = ResponseService._instance
        instance.requested_id = headers.get('requestedid', '')
        instance.requested_time = headers.get('requestedtime', int(datetime.now().timestamp() * 1000))
        instance.start = int(datetime.now().timestamp() * 1000)
        instance.cold_start = False
        instance.headers.update({
            'Content-Type': headers.get('content-type', 'application/json'),
            'requestedId': instance.requested_id,
            'requestedTime': instance.requested_time,
            'start': instance.start,
            'coldStart': instance.cold_start,
        })
        instance.query_string_parameters = event.get('queryStringParameters', {})
        instance.path_parameters = event.get('pathParameters', {})
        instance.body = self._get_parsed_body_from_event(event.get('body', '')) if event.get('body') else ''

    def _get_parsed_body_from_event(self, body: Union[str, Dict]) -> Any:
        try:
            if isinstance(body, str):
                if not body.strip():
                    return {}
                return json.loads(body)
            return body
        except json.JSONDecodeError as e:
            self.logger.error(f"[COMMON][ERROR][getParsedBodyFromEvent] {str(e)}")
            raise self._handle_error('INVALID_PARAMETER_VALUE', f"Unable to Parse JSON Body [{body}]")

    def add_custom_response(self, code: Optional[Dict], params: Dict, response_body: Optional[Dict] = None) -> Dict:
        response_body = response_body or {}
        if code:
            response_body['resultMessage'] = code['MESSAGE'] + (f" ({params['message']})" if params.get('message') else '')
            response_body['resultCode'] = code['CODE']
        else:
            message = RESPONSE_CODES.UNKNOWN['MESSAGE']
            if params.get('type'):
                message += f" [{params['type']}]"
            if params.get('message'):
                message += f" ({params['message']})"
            response_body['resultMessage'] = message
            response_body['resultCode'] = RESPONSE_CODES.UNKNOWN['CODE']
        return response_body

    def create_set_cookie_response(self, status_code: int, headers: Optional[Dict] = None, cookies: Optional[List[Dict]] = None) -> Union[None, Dict]:
        headers = headers or {}
        cookies = cookies or []
        if self.is_ecs:
            # Framework-specific: Adjust for Flask, FastAPI, etc.
            for cookie in cookies:
                # Example: self.res.set_header('Set-Cookie', f"{cookie['name']}={cookie['value']}; {cookie.get('option', {})}")
                self.res.set_header(cookie['name'], cookie['value'], cookie.get('option', {}))
            # Example for Flask: return self.res.status_code = status_code; return self.res
            self.res.status(status_code).end()  # Framework-specific
        else:
            return {
                'statusCode': status_code,
                'cookies': cookies,
                'headers': headers,
            }

    def create_response_with_cookies(self, status_code: int, response_body: Any, headers: Optional[Dict] = None, cookies: Optional[List] = None) -> Union[None, Dict]:
        headers = headers or {}
        cookies = cookies or []
        if self.is_ecs:
            updated_headers = {
                **self.headers,
                **headers,
                'end': int(datetime.now().timestamp() * 1000),
                'ecs': True,
            }
            # Framework-specific: Set headers
            for key, value in updated_headers.items():
                self.res.set_header(key, value)
            self.res.set_header('Set-Cookie', cookies)
            self.res.write(json.dumps(response_body) if isinstance(response_body, (dict, list)) else response_body)
            # Example for Flask: self.res.status_code = status_code; return self.res
            self.res.status(status_code).end()
        else:
            self.headers['end'] = int(datetime.now().timestamp() * 1000)
            return {
                'statusCode': status_code,
                'cookies': cookies,
                'headers': {**self.headers, **headers},
                'body': json.dumps(response_body) if isinstance(response_body, (dict, list)) else response_body,
            }

    def create_response(self, status_code: int, response_body: Any, headers: Optional[Dict] = None, is_base64_encoded: bool = False) -> Union[None, Dict]:
        headers = headers or {}
        need_stringify = isinstance(response_body, (dict, list))
        
        if self.is_ecs:
            updated_headers = {
                **self.headers,
                **headers,
                'end': int(datetime.now().timestamp() * 1000),
                'ecs': True,
            }
            # Framework-specific: Set headers and response
            for key, value in updated_headers.items():
                self.res.set_header(key, value)
            self.res.status(status_code).send(json.dumps(response_body) if need_stringify else response_body)
            # Example for Flask: return Response(response=..., status=status_code, headers=updated_headers)
        else:
            self.headers['end'] = int(datetime.now().timestamp() * 1000)
            return {
                'statusCode': status_code,
                'headers': {**self.headers, **headers},
                'body': json.dumps(response_body) if need_stringify else response_body,
                'isBase64Encoded': is_base64_encoded,
            }

    def create_no_content_http_response(self, response_body: Any) -> Union[None, Dict]:
        return self.create_response(HTTPStatus.NO_CONTENT, response_body)

    def create_accepted_http_response(self, response_body: Any) -> Union[None, Dict]:
        return self.create_response(HTTPStatus.ACCEPTED, response_body)

    def create_ok_http_response(self, response_body: Any) -> Union[None, Dict]:
        response_body = self.add_custom_response(RESPONSE_CODES.OK, {}, response_body)
        return self.create_response(HTTPStatus.OK, response_body)

    def create_created_http_response(self, object_id: Any = None, api_path: Optional[str] = None) -> Union[None, Dict]:
        if self.is_ecs:
            if object_id is not None and api_path is not None:
                return self.create_response(HTTPStatus.CREATED, {'id': object_id, 'href': api_path})
            # Framework-specific: self.res.status_code = HTTPStatus.CREATED; return self.res
            self.res.status(HTTPStatus.CREATED).end()
        else:
            response = {'id': object_id, 'href': api_path} if object_id is not None and api_path is not None else {}
            return self.create_response(HTTPStatus.CREATED, response)

    def create_error_http_response(self, status_code: int, error_object: Exception, body: Optional[Dict] = None) -> Union[None, Dict]:
        self.logger.error(f"[{status_code}] {str(error_object)}")
        response_body = self.add_custom_response(
            RESPONSE_CODES.get(getattr(error_object, 'name', 'UNKNOWN'), RESPONSE_CODES.UNKNOWN),
            {'type': getattr(error_object, 'name', 'UNKNOWN'), 'message': str(error_object)},
            body
        )
        return self.create_response(status_code, response_body)

    def _handle_error(self, error_type: str, error_message: str) -> Exception:
        error = Exception(error_message)
        error.name = error_type
        return error

    def add_header(self, key: str, value: Any):
        self.headers[key] = value

    def append_header(self, key: str, value: Any):
        if key in self.headers:
            self.headers[key] = f"{self.headers[key]};{value}"
        else:
            self.headers[key] = value
