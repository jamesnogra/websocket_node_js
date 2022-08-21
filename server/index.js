const WebSocket = require('ws')

const wss = new WebSocket.Server({ port: 8082 })

var players = []
const gameInfos = []
const timeToShowQuestions = 5 // Seconds to show question
const timeRest = 5 // Seconds before showing next question
var questionTimer = 0
var gameStoped = false

wss.on('connection', ws => {
	console.log('NEW CLIENT CONNECTED');

	// Wait for client data being sent
	ws.on('message', data => {
		const dataInfo = JSON.parse(data)
		// New player joined
		if (dataInfo.info === 'NEW_PLAYER') {
			// Add this player
			addPlayer(dataInfo)
			// Attempt to create a new game info
			createGameInfo(dataInfo.code)
		}
		// Add 1 point to specific user
		if (dataInfo.info === 'ADD_1_TO_SCORE') {
			addPointToPlayer(dataInfo)
		}
		if (dataInfo.info === 'START_GAME') {
			// Only with the master code can start the game
			if (isMasterCode(dataInfo.masterCode)) {
				console.log('GAME STARTED')
				gameStoped = false
				startGame(dataInfo.code)
			}
		}
		if (dataInfo.info === 'STOP_GAME') {
			// Only with the master code can start the game
			if (isMasterCode(dataInfo.masterCode)) {
				console.log('GAME STOPPED')
				gameStoped = true
				const gameInfo = gameInfos.find(res => res.code === dataInfo.code)
				endGame(dataInfo.code, gameInfo)
				wss.clients.forEach(function each(client) {
					client.send(JSON.stringify({'info': 'GAME_STOPPED', 'code': dataInfo.code}))
				})
			}
		}
		// Send to all the updated game info and players
		sendToAll(dataInfo.code)
	})
})

const sendToAll = (code) => {
	const playersInRoom = players.filter(res => res.code === code)
	wss.clients.forEach(function each(client) {
		client.send(JSON.stringify({'info': 'ALL_PLAYERS', 'code': code, 'players': playersInRoom}))
	})
}

const startGame = async (code) => {
	const gameInfo = gameInfos.find(res => res.code === code)
	const questions = gameInfo.images
	for (var x=0; x<questions.length; x++) {
		if (gameStoped) { // Stop this delay
			x = 9999
			return
		}
		// Send a timer to all
		sendTimeToAll(code, timeToShowQuestions)
		// Show question based on index
		showQuestion(gameInfo, code, x)
		await delay(timeToShowQuestions * 1000)
		// Get answers from players and show correct answer
		gameInfo.status = 'GET_SHOW_ANSWER'
		wss.clients.forEach(function each(client) {
			client.send(JSON.stringify({'info': 'GAME_INFO', 'code': code, 'gameInfo': gameInfo}))
		})
		// Show information about the answer
		gameInfo.status = 'SHOW_ANSWER_DESCRIPTION'
		// Send score information
		sendToAll(code)
		wss.clients.forEach(function each(client) {
			client.send(JSON.stringify({'info': 'GAME_INFO', 'code': code, 'gameInfo': gameInfo}))
		})
		await delay(timeRest * 1000)
	}
	endGame(code, gameInfo)
}

const endGame = (code, gameInfo) => {
	if (gameInfo === undefined) { return }
	// END OF GAME
	gameInfo.questionIndex = -1
	gameInfo.status = 'END'
	// Send players at end
	gameInfo.players = players.filter(res => res.code === code)
	wss.clients.forEach(function each(client) {
		client.send(JSON.stringify({'info': 'GAME_INFO', 'code': code, 'gameInfo': gameInfo}))
	})
	// Clear this game code
	clearGameCode(code)
}

const clearGameCode = (code) => {
	// Remove game info with this code
	const gameIndex = gameInfos.findIndex(obj => obj.code === code)
	if (gameIndex > -1) {
		gameInfos.splice(gameIndex, 1)
	}
	// Remove all players with this code
	players = players.filter(function( obj ) {
		return obj.code !== code;
	})
}

const delay = ms => new Promise(res => setTimeout(res, ms))

const showQuestion = (gameInfo, code, loopIndex) => {
	gameInfo.questionIndex = loopIndex
	gameInfo.status = 'PLAYING'
	wss.clients.forEach(function each(client) {
		client.send(JSON.stringify({'info': 'GAME_INFO', 'code': code, 'gameInfo': gameInfo}))
	})
}

const sendTimeToAll = (code, totalSeconds) => {
	wss.clients.forEach(function each(client) {
		client.send(JSON.stringify({'info': 'TIME_INFO', 'code': code, 'totalSeconds': totalSeconds}))
	})
}

const createGameInfo = (code) => {
	const gameInfo = gameInfos.find(res => res.code === code)
	// Do not add if there is a gameInfo with this code
	if (gameInfo !== undefined) {
		return
	}
	gameInfos.push({
		'code': code,
		'questionIndex': -1,
		'status': 'STANDBY',
		'images': (code === 'PEOPLE') ? people : ((code === 'PLACES') ? places : trialRun)
	})
}

const addPlayer = (userInfo) => {
	var master = false
	if (isMasterCode(userInfo.masterCode)) {
		master = true 
	}
	players.push({
		'code': userInfo.code,
		'name': userInfo.name,
		'score': 0,
		'master': master
	})
}

const addPointToPlayer = (userInfo) => {
	// Find this player with code and name 
	const playerIndex = players.findIndex(obj => obj.code === userInfo.code && obj.name === userInfo.name)
	// Add one point
	if (playerIndex > -1) {
		players[playerIndex].score += 1
	}
}

const isMasterCode = (masterCode) => {
	if (masterCode === 'thequickbrownfoxjumpsoverthelazydog123') {
		return true
	}
	return false
}

function sleep(time, callback) {
	var stop = new Date().getTime();
	while(new Date().getTime() < stop + time) {
		;
	}
	callback();
}

// For encrypting the answer
const cipher = salt => {
	const textToChars = text => text.split('').map(c => c.charCodeAt(0));
	const byteHex = n => ("0" + Number(n).toString(16)).substr(-2);
	const applySaltToChar = code => textToChars(salt).reduce((a,b) => a ^ b, code);

	return text => text.split('')
		.map(textToChars)
		.map(applySaltToChar)
		.map(byteHex)
		.join('');
}
const decipher = salt => {
	const textToChars = text => text.split('').map(c => c.charCodeAt(0));
	const applySaltToChar = code => textToChars(salt).reduce((a,b) => a ^ b, code);
	return encoded => encoded.match(/.{1,2}/g)
		.map(hex => parseInt(hex, 16))
		.map(applySaltToChar)
		.map(charCode => String.fromCharCode(charCode))
		.join('');
}
// Encrypt answers
const salt = 'TEST_SALT_123456'
const myCipher = cipher(salt)

const trialRun = [
	{
		'image': 'https://static.dw.com/image/47429859_401.jpg',
		'options': ['apple', 'orange', 'grape'],
		'answer': myCipher('apple'),
		'answerDescription': 'This is an apple'
	},
	{
		'image': 'https://scx2.b-cdn.net/gfx/news/2022/grapes.jpg',
		'options': ['apple', 'orange', 'grape'],
		'answer': myCipher('grape'),
		'answerDescription': 'This is a grape'
	},
	{
		'image': 'https://post.medicalnewstoday.com/wp-content/uploads/sites/3/2022/01/mangoes_what_to_know_732x549_thumb-732x549.jpg',
		'options': ['mango', 'grape'],
		'answer': myCipher('mango'),
		'answerDescription': 'This is a mango'
	},
	{
		'image': 'https://cdn.britannica.com/99/143599-050-C3289491/Watermelon.jpg?w=400&h=300&c=crop',
		'options': ['apple', 'orange', 'watermelon', 'grape'],
		'answer': myCipher('watermelon'),
		'answerDescription': 'This is a watermelon'
	},
	{
		'image': 'https://helios-i.mashable.com/imagery/articles/05W5DssM7oLPbBjiU4ZY6ob/hero-image.fill.size_1248x702.v1645798494.jpg',
		'options': ['orange', 'apple', 'pineapple', 'watermelon', 'grape'],
		'answer': myCipher('pineapple'),
		'answerDescription': 'This is a pineapple'
	}
]

const places = [
	{
		'image': 'images/places/1.jpg',
		'options': ['Tokyo', 'Paris', 'Toronto', 'Singapore'],
		'answer': myCipher('Paris'),
		'answerDescription': 'Paris with the Eiffel Tower & Seine River in Paris, France.'
	},
	{
		'image': 'images/places/2.jpg',
		'options': ['Norway', 'Egypt', 'USA', 'Singapore'],
		'answer': myCipher('USA'),
		'answerDescription': 'The Pentagon is the headquarters building of the United States Department of Defense.'
	},
	{
		'image': 'images/places/3.jpg',
		'options': ['Singapore', 'Hong_Kong', 'Macau', 'Jakarta', 'Manila'],
		'answer': myCipher('Singapore'),
		'answerDescription': 'Singapore, officially the Republic of Singapore, is a sovereign island country and city-state in maritime Southeast Asia.'
	},
	{
		'image': 'images/places/4.jpg',
		'options': ['Venice', 'Taguig_City', 'Rome', 'Jerusalem'],
		'answer': myCipher('Taguig_City'),
		'answerDescription': 'Venice Grand Canal is a lifestyle mall development under Megaworld Lifestyle Malls located inside the 50-hectare (120-acre) McKinley Hill township of Megaworld Corporation in Taguig City.'
	},
	{
		'image': 'images/places/5.jpg',
		'options': ['Tokyo', 'Kyoto', 'Cebu_City', 'Manila'],
		'answer': myCipher('Cebu_City'),
		'answerDescription': 'Yes, you’ve read it right, located in Babag after Busay, Cebu City is Sachiko’s Little Kyoto.'
	},
	{
		'image': 'images/places/6.jpg',
		'options': ['Kyoto', 'Cebu_City', 'Bali'],
		'answer': myCipher('Kyoto'),
		'answerDescription': 'Beautiful bamboo forest situated in Arashiyama is the second-most popular tourist district in Kyoto.'
	},
	{
		'image': 'images/places/7.jpg',
		'options': ['UAE', 'Saudi_Arabia'],
		'answer': myCipher('Saudi_Arabia'),
		'answerDescription': 'With millions of Overseas Filipino Workers (OFWs) living and working in Saudi Arabia, you will find not only one or two… but 14 Jollibee branches across the Kingdom!'
	},
	{
		'image': 'images/places/8.jpg',
		'options': ['South_Korea', 'North_Korea'],
		'answer': myCipher('North_Korea'),
		'answerDescription': 'North Korean leader Kim Jong Un opened a new mountain spa and ski resort that’s intended for people to enjoy “high civilisation under socialism” in another example of the country using tourism exemptions in sanctions to build revenue for its broken economy.'
	},
	{
		'image': 'images/places/9.jpg',
		'options': ['Singapore', 'Philippines'],
		'answer': myCipher('Singapore'),
		'answerDescription': '51 Bras Basah Road, #01-21, Lazada One, Singapore 189554.'
	},
	{
		'image': 'images/places/10.jpg',
		'options': ['Bali', 'Tagaytay', 'Fukushima', 'Iceland'],
		'answer': myCipher('Tagaytay'),
		'answerDescription': 'Starbucks in Tagaytay!'
	},
	{
		'image': 'images/places/11.jpg',
		'options': ['Philippines', 'China', 'Spain'],
		'answer': myCipher('China'),
		'answerDescription': 'Jose Rizal Square in Jinjiang, China.'
	},
	{
		'image': 'images/places/12.jpg',
		'options': ['Siargao', 'Bohol', 'Cebu', 'Ilocos', 'Cagayan', 'Iloilo'],
		'answer': myCipher('Bohol'),
		'answerDescription': 'Loboc River in Bohol.'
	},
	{
		'image': 'images/places/13.jpg',
		'options': ['Singapore', 'Japan'],
		'answer': myCipher('Singapore'),
		'answerDescription': 'There are 21 Jollibean Singapore locations.'
	},
	{
		'image': 'images/places/14.jpg',
		'options': ['Vietnam', 'France', 'China'],
		'answer': myCipher('China'),
		'answerDescription': 'Eiffel Tower replica, Tianducheng, China.'
	},
	{
		'image': 'images/places/15.jpg',
		'options': ['Vietnam', 'Philippines'],
		'answer': myCipher('Vietnam'),
		'answerDescription': 'Mù Cang Chải\'s Vietnam terraces cover more than 2,000 hectares, stretching as far as the eye can see.'
	}
]

const people = [
	{
		'image': 'images/people/1.jpg',
		'options': ['Pornstar', 'Cartoon_Actress'],
		'answer': myCipher('Pornstar'),
		'answerDescription': 'Adult star Asa Akira appeared in one of the episodes of Family Guy.'
	},
	{
		'image': 'images/people/2.jpg',
		'options': ['Pornstar', 'Doctor', 'Stock_Photo_Model'],
		'answer': myCipher('Pornstar'),
		'answerDescription': 'Johnny Sins is an American pornographic actor.'
	},
	{
		'image': 'images/people/3.jpg',
		'options': ['Pornstar', 'Politician', 'Celebrity'],
		'answer': myCipher('Politician'),
		'answerDescription': 'Emmanuel Macron is the current president of France.'
	},
	{
		'image': 'images/people/4.jpg',
		'options': ['Vivamax_Actor', 'Politician'],
		'answer': myCipher('Politician'),
		'answerDescription': 'Miguel "Migz" Villafuerte is a Filipino politician who has been Governor of Camarines Sur from 2013 to 2022.'
	},
	{
		'image': 'images/people/5.jpg',
		'options': ['Onlyfans_Pornstar', 'Singer_Nun'],
		'answer': myCipher('Singer_Nun'),
		'answerDescription': 'Sister Cristina Scuccia is an Italian singer and Ursuline nun who won the 2014 season of The Voice of Italy.'
	},
	{
		'image': 'images/people/6.jpg',
		'options': ['Priest', 'Onlyfans'],
		'answer': myCipher('Priest'),
		'answerDescription': 'Oskar Arngarden is a Lutheran priest for the Church of Sweden.'
	},
	{
		'image': 'images/people/7.jpg',
		'options': ['Radio_Reporter', 'Pornstar', 'Stock_Photo_Model'],
		'answer': myCipher('Pornstar'),
		'answerDescription': 'Sasha Grey first made her name as one of the most notorious adult film stars in recent history.'
	},
	{
		'image': 'images/people/8.jpg',
		'options': ['Pornstar', 'Chess_Grandmaster', 'IQ170', 'Chemist'],
		'answer': myCipher('Pornstar'),
		'answerDescription': 'Jordi "El Niño Polla", often shortened to Jordi ENP, is a Spanish pornographic actor.'
	},
	{
		'image': 'images/people/9.jpg',
		'options': ['Onlyfans', 'Physicist', 'Stock_Broker'],
		'answer': myCipher('Physicist'),
		'answerDescription': 'Stephen William Hawking was an English theoretical physicist, cosmologist, and author.'
	},
	{
		'image': 'images/people/10.jpg',
		'options': ['Biochemist', 'MILF_Actress', 'Astronaut'],
		'answer': myCipher('Biochemist'),
		'answerDescription': 'Jennifer Doudna is a biochemist and the Nobel Prize winner for CRISPR-Cas9.'
	},
	{
		'image': 'images/people/11.jpg',
		'options': ['Onlyfans', 'Priest', 'Model', 'Cosplayer'],
		'answer': myCipher('Priest'),
		'answerDescription': 'Chris Lee is an Anglican priest-in-charge at St. Saviour\'s Church in Wendell Park, West London.'
	},
	{
		'image': 'images/people/12.jpg',
		'options': ['News_Reporter', 'Impersonator'],
		'answer': myCipher('Impersonator'),
		'answerDescription': 'Jervi Ryan Li (also known as KaladKaren Davila) is a Filipino trans woman and impersonator.'
	},
	{
		'image': 'images/people/13.jpg',
		'options': ['Celebrity', 'Activist', 'Model'],
		'answer': myCipher('Celebrity'),
		'answerDescription': 'Benedict Cumberbatch played a non-binary role in Zoolander 2.'
	},
	{
		'image': 'images/people/14.jpg',
		'options': ['Trump_Son', 'Biden_Son', 'Brad_Pitt_Son'],
		'answer': myCipher('Trump_Son'),
		'answerDescription': 'Barron Trump is Donald Trump\'s only child with First Lady Melania.'
	},
	{
		'image': 'images/people/15.jpg',
		'options': ['Pornstar', 'Nun', 'Both'],
		'answer': myCipher('Both'),
		'answerDescription': 'She\'s a devoted Catholic nun from Colombia. In 2019 she signed a multi-scene deal with BangBros.'
	}
]