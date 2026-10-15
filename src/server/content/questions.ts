import { buildAnswerIndex, analyzeAnswerSet, type AnswerDefinition, type AnswerIndex, type IndexProblem } from '@/domain/normalization';
import { weightsToPpm } from './priors';

// The launch question bank: ORIGINAL questions with CLOSED answer sets (ARCHITECTURE.md §18.7),
// written for an Indian audience (version 2).
//
// HONESTY NOTE. Every question, alias and prior below was drafted by the build agent from general
// knowledge. Nothing was independently verified, and the priors are editorial GUESSES at how people
// answer, not measured data. They need human review before this is treated as a published bank.
// A closed set also means a valid-but-unlisted answer is rejected, so each question states its
// boundary in `qualifier`.
//
// NO HINTS. A qualifier states only the SCOPE of the question (what kind of thing counts). It never
// names an accepted answer, gives an example, or says how many answers there are of a given kind
// beyond what the scope itself requires. Spelling mistakes are auto-corrected (normalization v2), so
// aliases only need to cover genuinely different names (Hindi names, old names, abbreviations).

export const QUESTION_VERSION = 2;

export const VERIFICATION_NOTE =
  'Drafted from general knowledge by the build agent. Unverified. Priors are editorial guesses.';

type AnswerSpec = readonly [text: string, weight: number, aliases?: readonly string[]];

interface QuestionSpec {
  readonly id: string;
  readonly category: string;
  readonly prompt: string;
  /** The scope of the question. Never an example, never a hint. */
  readonly qualifier: string;
  readonly answers: readonly AnswerSpec[];
}

export interface PublicQuestion {
  readonly id: string;
  readonly category: string;
  readonly prompt: string;
  readonly qualifier: string;
}

export interface PublishedAnswer {
  readonly id: string;
  readonly text: string;
  readonly aliases: readonly string[];
  readonly priorPpm: number;
}

export interface PublishedQuestion extends PublicQuestion {
  readonly version: number;
  readonly answers: readonly PublishedAnswer[];
}

/**
 * Stable answer id from the canonical text. Symbols that carry meaning are spelled out first, so
 * "C", "C++" and "C#" stay distinct ("c", "c-plus-plus", "c-sharp") instead of all becoming "c".
 * Two answers that still collide are caught by the publication check (validateBank), not hidden.
 */
function slug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/#/g, ' sharp ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SPECS: readonly QuestionSpec[] = [
  {
    id: 'indian-state',
    category: 'India: Geography',
    prompt: 'Name a state of India.',
    qualifier: 'States only. Union territories do not count.',
    answers: [
      ['Maharashtra', 8], ['Uttar Pradesh', 7, ['UP']], ['Tamil Nadu', 7, ['TN', 'Tamilnadu']],
      ['Kerala', 7, ['Keralam']], ['Karnataka', 7], ['Gujarat', 6], ['Rajasthan', 6],
      ['West Bengal', 5, ['Bengal']], ['Punjab', 5], ['Goa', 5], ['Bihar', 4],
      ['Madhya Pradesh', 3, ['MP']], ['Andhra Pradesh', 3], ['Telangana', 3], ['Haryana', 3],
      ['Himachal Pradesh', 3, ['HP']], ['Odisha', 2, ['Orissa']], ['Assam', 2], ['Uttarakhand', 2, ['Uttaranchal']],
      ['Jharkhand', 1.5], ['Chhattisgarh', 1, ['Chattisgarh']], ['Sikkim', 1.2], ['Meghalaya', 1],
      ['Manipur', 0.6], ['Mizoram', 0.5], ['Nagaland', 0.5], ['Arunachal Pradesh', 0.5], ['Tripura', 0.4],
    ],
  },
  {
    id: 'union-territory',
    category: 'India: Geography',
    prompt: 'Name a Union Territory of India.',
    qualifier: 'Current Union territories only. States do not count.',
    answers: [
      ['Delhi', 40, ['New Delhi', 'NCT of Delhi']], ['Jammu and Kashmir', 14, ['J&K', 'Jammu', 'Kashmir']],
      ['Ladakh', 10], ['Chandigarh', 10], ['Puducherry', 9, ['Pondicherry']],
      ['Andaman and Nicobar Islands', 8, ['Andaman', 'Andaman and Nicobar', 'Nicobar']],
      ['Lakshadweep', 5], ['Dadra and Nagar Haveli and Daman and Diu', 1.5, ['Dadra and Nagar Haveli', 'Daman and Diu', 'Daman', 'Diu']],
    ],
  },
  {
    id: 'indian-river',
    category: 'India: Geography',
    prompt: 'Name a river that flows through India.',
    qualifier: 'Rivers with a significant stretch inside India. Streams and canals do not count.',
    answers: [
      ['Ganga', 25, ['Ganges']], ['Yamuna', 15, ['Jamuna']], ['Brahmaputra', 8], ['Godavari', 8],
      ['Narmada', 8, ['Narbada']], ['Krishna', 7], ['Kaveri', 7, ['Cauvery']], ['Indus', 5],
      ['Mahanadi', 3], ['Tapti', 2, ['Tapi']], ['Sutlej', 2], ['Sabarmati', 1.5], ['Chambal', 0.8],
      ['Beas', 1], ['Ravi', 1], ['Chenab', 1], ['Jhelum', 1], ['Gomti', 1], ['Hooghly', 1],
      ['Tungabhadra', 0.5], ['Periyar', 0.5], ['Kosi', 0.5], ['Damodar', 0.5], ['Son', 0.4],
      ['Betwa', 0.3], ['Luni', 0.2],
    ],
  },
  {
    id: 'indian-festival',
    category: 'India: Culture',
    prompt: 'Name a festival celebrated in India.',
    qualifier: 'Religious, harvest and seasonal festivals that are celebrated across a state or the country.',
    answers: [
      ['Diwali', 25, ['Deepavali', 'Deepawali']], ['Holi', 22], ['Eid', 8, ['Eid ul Fitr', 'Eid al Fitr', 'Id']],
      ['Dussehra', 6, ['Dasara', 'Vijayadashami']], ['Navratri', 6, ['Navaratri']], ['Ganesh Chaturthi', 5, ['Ganesh Utsav', 'Vinayaka Chaturthi']],
      ['Durga Puja', 5], ['Raksha Bandhan', 4, ['Rakhi', 'Rakshabandhan']], ['Christmas', 4],
      ['Pongal', 3], ['Onam', 3], ['Makar Sankranti', 2, ['Sankranti']], ['Lohri', 2],
      ['Janmashtami', 2, ['Krishna Janmashtami']], ['Baisakhi', 1.5, ['Vaisakhi']], ['Maha Shivaratri', 1.5, ['Shivaratri']],
      ['Karva Chauth', 1], ['Ugadi', 0.8], ['Bihu', 0.8], ['Chhath Puja', 0.8, ['Chhath']],
      ['Gudi Padwa', 0.6], ['Rath Yatra', 0.6], ['Hornbill Festival', 0.2],
    ],
  },
  {
    id: 'ipl-team',
    category: 'India: Cricket',
    prompt: 'Name a team that has played in the Indian Premier League.',
    qualifier: 'Franchises past and present. Use the team name.',
    answers: [
      ['Mumbai Indians', 20, ['MI']], ['Chennai Super Kings', 20, ['CSK']],
      ['Royal Challengers Bengaluru', 15, ['RCB', 'Royal Challengers Bangalore']],
      ['Kolkata Knight Riders', 12, ['KKR']], ['Delhi Capitals', 8, ['DC', 'Delhi Daredevils']],
      ['Sunrisers Hyderabad', 6, ['SRH']], ['Rajasthan Royals', 6, ['RR']],
      ['Punjab Kings', 5, ['PBKS', 'Kings XI Punjab']], ['Gujarat Titans', 3, ['GT']],
      ['Lucknow Super Giants', 3, ['LSG']], ['Deccan Chargers', 1.5], ['Gujarat Lions', 0.4],
      ['Rising Pune Supergiant', 0.3, ['Rising Pune Supergiants']], ['Pune Warriors India', 0.3, ['Pune Warriors']],
      ['Kochi Tuskers Kerala', 0.2, ['Kochi Tuskers']],
    ],
  },
  {
    id: 'bollywood-actor',
    category: 'India: Cinema',
    prompt: 'Name a Hindi film actor.',
    qualifier: 'Actors of any gender who have worked in Hindi cinema. Give the full name or the name they are best known by.',
    answers: [
      ['Shah Rukh Khan', 20, ['SRK', 'Shahrukh Khan', 'Shahrukh', 'Shah Rukh']], ['Amitabh Bachchan', 18, ['Amitabh', 'Big B']],
      ['Salman Khan', 12, ['Salman']], ['Aamir Khan', 10, ['Aamir']], ['Akshay Kumar', 8, ['Akshay']],
      ['Deepika Padukone', 7, ['Deepika']], ['Priyanka Chopra', 5, ['Priyanka Chopra Jonas']], ['Alia Bhatt', 5],
      ['Ranbir Kapoor', 4], ['Hrithik Roshan', 4, ['Hrithik']], ['Ranveer Singh', 3], ['Katrina Kaif', 3, ['Katrina']],
      ['Kareena Kapoor', 3, ['Kareena Kapoor Khan', 'Kareena']], ['Madhuri Dixit', 2.5], ['Anil Kapoor', 2],
      ['Kangana Ranaut', 1.5], ['Vidya Balan', 1.5], ['Irrfan Khan', 1.5, ['Irrfan']], ['Rajkummar Rao', 1],
      ['Ayushmann Khurrana', 1], ['Vicky Kaushal', 1], ['Nawazuddin Siddiqui', 1], ['Dharmendra', 1.2],
      ['Rekha', 1], ['Pankaj Tripathi', 0.6], ['Taapsee Pannu', 0.6], ['Dev Anand', 0.5], ['Raj Kapoor', 0.5],
      ['Dilip Kumar', 0.5], ['Naseeruddin Shah', 0.4], ['Smita Patil', 0.3], ['Om Puri', 0.3],
    ],
  },
  {
    id: 'scheduled-language',
    category: 'India: Language',
    prompt: 'Name a language of India.',
    qualifier: 'Languages listed in the Eighth Schedule of the Constitution of India. Dialects and English do not count.',
    answers: [
      ['Hindi', 30], ['Tamil', 10], ['Bengali', 10, ['Bangla']], ['Telugu', 9], ['Marathi', 8],
      ['Gujarati', 6], ['Kannada', 6], ['Malayalam', 6], ['Punjabi', 5], ['Urdu', 4], ['Sanskrit', 3],
      ['Odia', 1.5, ['Oriya']], ['Assamese', 1.5], ['Sindhi', 0.8], ['Nepali', 0.7], ['Konkani', 0.6],
      ['Kashmiri', 0.5], ['Maithili', 0.5], ['Manipuri', 0.3, ['Meitei', 'Meiteilon']], ['Santali', 0.3],
      ['Dogri', 0.2], ['Bodo', 0.2],
    ],
  },
  {
    id: 'indian-dish',
    category: 'India: Food',
    prompt: 'Name a dish from Indian cuisine.',
    qualifier: 'Cooked dishes and sweets. Ingredients, spices and drinks do not count.',
    answers: [
      ['Biryani', 15, ['Biriyani']], ['Butter Chicken', 10, ['Murgh Makhani']], ['Dosa', 9, ['Dosai']], ['Samosa', 8],
      ['Idli', 6], ['Paneer Tikka', 5], ['Dal Makhani', 4], ['Chole Bhature', 4, ['Chana Bhatura']],
      ['Vada Pav', 4], ['Gulab Jamun', 4], ['Pani Puri', 4, ['Golgappa', 'Gol Gappa', 'Puchka']], ['Pav Bhaji', 3],
      ['Palak Paneer', 3], ['Naan', 3], ['Jalebi', 3], ['Rasgulla', 3, ['Rosogolla']], ['Paratha', 3],
      ['Rajma', 2.5], ['Poha', 1.5], ['Upma', 1.5], ['Khichdi', 1.5], ['Kulfi', 1.5], ['Dhokla', 1.2],
      ['Rogan Josh', 1], ['Appam', 0.8], ['Haleem', 0.6], ['Misal Pav', 0.5], ['Litti Chokha', 0.5],
      ['Sarson da Saag', 0.4], ['Sandesh', 0.4], ['Puran Poli', 0.3], ['Pesarattu', 0.2],
    ],
  },
  {
    id: 'test-captain',
    category: 'India: Cricket',
    prompt: 'Name a cricketer who has captained India in a Test match.',
    qualifier: 'Men\u2019s Test captains of India, including those who captained only a few matches.',
    answers: [
      ['MS Dhoni', 22, ['Mahendra Singh Dhoni', 'Dhoni', 'Mahi']], ['Virat Kohli', 22, ['Kohli', 'Virat']],
      ['Sunil Gavaskar', 8, ['Gavaskar']], ['Rahul Dravid', 7, ['Dravid']], ['Sourav Ganguly', 7, ['Ganguly', 'Dada']],
      ['Kapil Dev', 6, ['Kapil']], ['Sachin Tendulkar', 5, ['Tendulkar', 'Sachin']], ['Rohit Sharma', 5, ['Rohit']],
      ['Mohammad Azharuddin', 4, ['Azharuddin', 'Azhar']], ['Anil Kumble', 3, ['Kumble']], ['Shubman Gill', 2, ['Gill']],
      ['Virender Sehwag', 1, ['Sehwag']], ['Bishan Singh Bedi', 1, ['Bedi']],
      ['Mansoor Ali Khan Pataudi', 1, ['Pataudi', 'Tiger Pataudi']], ['Ajit Wadekar', 0.8, ['Wadekar']],
      ['Dilip Vengsarkar', 0.6, ['Vengsarkar']], ['Jasprit Bumrah', 0.6, ['Bumrah']], ['Ajinkya Rahane', 0.5, ['Rahane']],
      ['Vijay Hazare', 0.3, ['Hazare']], ['Lala Amarnath', 0.3, ['Amarnath']], ['Polly Umrigar', 0.2, ['Umrigar']],
      ['Nari Contractor', 0.2, ['Contractor']],
    ],
  },
  {
    id: 'hill-station',
    category: 'India: Travel',
    prompt: 'Name a hill station in India.',
    qualifier: 'Towns in the hills that are known as summer retreats.',
    answers: [
      ['Shimla', 18, ['Simla']], ['Manali', 15], ['Darjeeling', 12], ['Ooty', 12, ['Udhagamandalam', 'Ootacamund']],
      ['Munnar', 8], ['Mussoorie', 7], ['Nainital', 6], ['Kodaikanal', 4], ['Mount Abu', 3],
      ['Coorg', 3, ['Kodagu', 'Madikeri']], ['Gulmarg', 3], ['Mahabaleshwar', 2.5], ['Lonavala', 2.5],
      ['Dalhousie', 2], ['Shillong', 2], ['Gangtok', 2], ['Kasauli', 1], ['Almora', 0.8], ['Ranikhet', 0.8],
      ['Lansdowne', 0.8], ['Matheran', 0.7], ['Pachmarhi', 0.5], ['Panchgani', 0.4], ['Chail', 0.3],
      ['Coonoor', 0.3], ['Yercaud', 0.3], ['Khajjiar', 0.3], ['Auli', 0.3],
    ],
  },
  {
    id: 'national-park',
    category: 'India: Wildlife',
    prompt: 'Name a national park in India.',
    qualifier: 'Areas notified as national parks. Wildlife sanctuaries and tiger reserves that are not national parks do not count.',
    answers: [
      ['Jim Corbett', 18, ['Corbett', 'Jim Corbett National Park']], ['Ranthambore', 15, ['Ranthambhore']], ['Kaziranga', 14],
      ['Gir', 10], ['Bandipur', 6], ['Kanha', 5], ['Sundarbans', 5], ['Periyar', 3], ['Bandhavgarh', 3],
      ['Nagarhole', 2, ['Rajiv Gandhi National Park']], ['Pench', 2], ['Tadoba', 2], ['Sariska', 2],
      ['Manas', 1.5], ['Keoladeo', 1.5, ['Bharatpur']], ['Hemis', 1], ['Silent Valley', 0.8], ['Panna', 0.8],
      ['Dudhwa', 0.7], ['Nanda Devi', 0.6], ['Satpura', 0.6], ['Eravikulam', 0.6], ['Simlipal', 0.5],
      ['Valley of Flowers', 0.5], ['Namdapha', 0.3],
    ],
  },
  {
    id: 'prime-minister',
    category: 'India: Politics',
    prompt: 'Name a Prime Minister of India.',
    qualifier: 'People who have held the office, including those who held it only briefly.',
    answers: [
      ['Narendra Modi', 18, ['Modi']], ['Jawaharlal Nehru', 15, ['Nehru']], ['Indira Gandhi', 14, ['Indira']],
      ['Manmohan Singh', 12, ['Dr Manmohan Singh']], ['Atal Bihari Vajpayee', 12, ['Vajpayee', 'Atal']],
      ['Rajiv Gandhi', 8], ['Lal Bahadur Shastri', 6, ['Shastri']], ['Morarji Desai', 4], ['P. V. Narasimha Rao', 3.5, ['Narasimha Rao', 'PV Narasimha Rao']],
      ['V. P. Singh', 1.5, ['VP Singh', 'Vishwanath Pratap Singh']], ['Charan Singh', 1], ['H. D. Deve Gowda', 0.8, ['Deve Gowda']],
      ['I. K. Gujral', 0.8, ['Gujral', 'IK Gujral']], ['Chandra Shekhar', 0.8], ['Gulzarilal Nanda', 0.3, ['Nanda']],
    ],
  },
  {
    id: 'classical-dance',
    category: 'India: Culture',
    prompt: 'Name a classical dance form of India.',
    qualifier: 'Dance forms formally recognised as classical. Folk dances do not count.',
    answers: [
      ['Bharatanatyam', 25, ['Bharatnatyam', 'Bharata Natyam']], ['Kathak', 22], ['Kathakali', 12], ['Odissi', 10, ['Orissi']],
      ['Kuchipudi', 8], ['Manipuri', 6], ['Mohiniyattam', 6, ['Mohini Attam']], ['Sattriya', 1.5],
    ],
  },
  {
    id: 'indian-instrument',
    category: 'India: Music',
    prompt: 'Name a traditional Indian musical instrument.',
    qualifier: 'Instruments of the Indian classical and folk traditions. Western instruments do not count.',
    answers: [
      ['Sitar', 20], ['Tabla', 20], ['Harmonium', 8], ['Bansuri', 8, ['Flute', 'Bamboo Flute']], ['Veena', 6, ['Vina']],
      ['Sarod', 5], ['Santoor', 4], ['Dholak', 4], ['Dhol', 3], ['Tanpura', 3, ['Tambura']], ['Shehnai', 3],
      ['Mridangam', 3], ['Sarangi', 1.5], ['Ektara', 1], ['Pakhawaj', 0.8], ['Nadaswaram', 0.8, ['Nagaswaram']],
      ['Ghatam', 0.6], ['Kanjira', 0.3], ['Esraj', 0.3], ['Dilruba', 0.3], ['Morsing', 0.2],
    ],
  },
  {
    id: 'freedom-fighter',
    category: 'India: History',
    prompt: 'Name a figure of the Indian freedom struggle.',
    qualifier: 'Leaders, revolutionaries and martyrs who fought British rule, from 1857 to 1947.',
    answers: [
      ['Mahatma Gandhi', 25, ['Gandhi', 'Mohandas Karamchand Gandhi', 'Gandhiji']], ['Jawaharlal Nehru', 12, ['Nehru']],
      ['Subhas Chandra Bose', 10, ['Netaji', 'Subhash Chandra Bose', 'Bose']], ['Bhagat Singh', 10],
      ['Sardar Patel', 8, ['Vallabhbhai Patel', 'Sardar Vallabhbhai Patel', 'Patel']], ['B. R. Ambedkar', 4, ['Ambedkar', 'BR Ambedkar']],
      ['Chandrashekhar Azad', 3, ['Chandra Shekhar Azad']], ['Lala Lajpat Rai', 3], ['Bal Gangadhar Tilak', 3, ['Tilak']],
      ['Sarojini Naidu', 2], ['Rani Lakshmibai', 2, ['Rani of Jhansi', 'Jhansi Ki Rani', 'Rani Laxmibai']], ['Mangal Pandey', 2],
      ['Gopal Krishna Gokhale', 1.5, ['Gokhale']], ['Rajendra Prasad', 1.5], ['Dadabhai Naoroji', 1],
      ['Maulana Azad', 1, ['Abul Kalam Azad']], ['Bipin Chandra Pal', 0.8], ['C. Rajagopalachari', 0.6, ['Rajaji', 'Rajagopalachari']],
      ['Tantia Tope', 0.5], ['Khudiram Bose', 0.4], ['Sukhdev', 0.4], ['Rajguru', 0.4], ['Ram Prasad Bismil', 0.4, ['Bismil']],
      ['Ashfaqulla Khan', 0.3], ['Aruna Asaf Ali', 0.3], ['Vinoba Bhave', 0.3], ['Annie Besant', 0.3],
    ],
  },
  {
    id: 'indian-monument',
    category: 'India: Travel',
    prompt: 'Name a famous monument or heritage site in India.',
    qualifier: 'Monuments, forts, palaces, temples and archaeological sites. Whole cities do not count.',
    answers: [
      ['Taj Mahal', 30], ['Red Fort', 14, ['Lal Qila']], ['Qutub Minar', 10, ['Qutb Minar']], ['India Gate', 8],
      ['Gateway of India', 6], ['Charminar', 5], ['Hawa Mahal', 4], ['Golden Temple', 4, ['Harmandir Sahib']],
      ['Amer Fort', 3, ['Amber Fort']], ['Victoria Memorial', 2.5], ['Mysore Palace', 2.5], ['Konark Sun Temple', 2.5, ['Konark']],
      ["Humayun's Tomb", 2, ['Humayun Tomb']], ['Lotus Temple', 2], ['Ajanta Caves', 1.5, ['Ajanta']], ['Ellora Caves', 1.5, ['Ellora']],
      ['Hampi', 1.5], ['Fatehpur Sikri', 1.5], ['Meenakshi Temple', 1.5, ['Meenakshi Amman Temple']], ['Khajuraho', 1],
      ['Jantar Mantar', 1], ['Mehrangarh Fort', 1, ['Mehrangarh']], ['Jaisalmer Fort', 0.8], ['Sanchi Stupa', 0.8, ['Sanchi']],
      ['Chittorgarh Fort', 0.6, ['Chittorgarh', 'Chittor Fort']], ['Elephanta Caves', 0.6], ['Gol Gumbaz', 0.5],
      ['Brihadisvara Temple', 0.5, ['Brihadeeswarar Temple', 'Brihadeshwara Temple', 'Thanjavur Big Temple']], ['Rani ki Vav', 0.3],
    ],
  },
  {
    id: 'indian-spice',
    category: 'India: Food',
    prompt: 'Name a spice used in Indian cooking.',
    qualifier: 'Single spices, whole or ground. Blends of spices do not count. Hindi names are accepted.',
    answers: [
      ['Turmeric', 20, ['Haldi']], ['Cumin', 15, ['Jeera']], ['Coriander', 12, ['Dhania']],
      ['Red Chilli', 12, ['Red Chili', 'Chilli', 'Chili', 'Mirchi', 'Lal Mirch', 'Chilli Powder']],
      ['Cardamom', 8, ['Elaichi']], ['Black Pepper', 8, ['Pepper', 'Kali Mirch']], ['Cinnamon', 6, ['Dalchini']],
      ['Cloves', 5, ['Clove', 'Laung']], ['Mustard Seeds', 5, ['Mustard', 'Sarson', 'Rai']], ['Fenugreek', 3, ['Methi']],
      ['Fennel', 3, ['Saunf']], ['Asafoetida', 2, ['Hing']], ['Bay Leaf', 2, ['Tej Patta']], ['Star Anise', 1.5, ['Chakri Phool']],
      ['Nutmeg', 1.5, ['Jaiphal']], ['Saffron', 1.5, ['Kesar']], ['Poppy Seeds', 0.8, ['Khus Khus']], ['Carom Seeds', 0.8, ['Ajwain']],
      ['Mace', 0.6, ['Javitri']], ['Nigella Seeds', 0.4, ['Kalonji']], ['Amchur', 0.3, ['Dry Mango Powder']], ['Kokum', 0.2],
    ],
  },
  {
    id: 'olympic-sport',
    category: 'India: Sport',
    prompt: 'Name a sport in which India has won an Olympic medal.',
    qualifier: 'Any Olympic medal won by an Indian athlete or team, at any Games.',
    answers: [
      ['Hockey', 30, ['Field Hockey']], ['Badminton', 14], ['Wrestling', 12], ['Shooting', 12], ['Athletics', 9, ['Javelin', 'Javelin Throw', 'Track and Field']],
      ['Boxing', 8], ['Weightlifting', 6], ['Tennis', 1.5],
    ],
  },
  {
    id: 'big-cat',
    category: 'India: Wildlife',
    prompt: 'Name a large wild cat found in the wild in India.',
    qualifier: 'Large cats with a living wild population in India today. Domestic cats and small wild cats do not count.',
    answers: [
      ['Tiger', 40, ['Bengal Tiger', 'Royal Bengal Tiger']], ['Lion', 25, ['Asiatic Lion']], ['Leopard', 22, ['Panther', 'Black Panther']],
      ['Snow Leopard', 6], ['Cheetah', 3], ['Clouded Leopard', 1.5],
    ],
  },
  {
    id: 'mughal-emperor',
    category: 'India: History',
    prompt: 'Name a Mughal emperor.',
    qualifier: 'Rulers who held the title of Mughal emperor, first to last.',
    answers: [
      ['Akbar', 25, ['Akbar the Great', 'Jalaluddin Akbar']], ['Shah Jahan', 20, ['Shahjahan']], ['Aurangzeb', 20, ['Alamgir', 'Aurangzeb Alamgir']],
      ['Babur', 12, ['Zahiruddin Babur']], ['Humayun', 8], ['Jahangir', 8], ['Bahadur Shah Zafar', 3, ['Zafar', 'Bahadur Shah II']],
      ['Shah Alam II', 0.5], ['Bahadur Shah I', 0.4], ['Muhammad Shah', 0.3], ['Farrukhsiyar', 0.3], ['Akbar II', 0.3],
      ['Jahandar Shah', 0.2],
    ],
  },
  {
    id: 'hindu-deity',
    category: 'India: Culture',
    prompt: 'Name a Hindu god or goddess.',
    qualifier: 'Deities worshipped in Hinduism, including avatars. Saints, gurus and epic heroes who are not deities do not count.',
    answers: [
      ['Ganesha', 20, ['Ganesh', 'Ganapati', 'Vinayaka']], ['Shiva', 18, ['Shiv', 'Mahadev', 'Shankar']], ['Krishna', 16, ['Kanha']],
      ['Hanuman', 12, ['Bajrang Bali', 'Bajrangbali']], ['Rama', 12, ['Ram', 'Shri Ram']], ['Vishnu', 8], ['Lakshmi', 8, ['Laxmi']],
      ['Durga', 7], ['Saraswati', 6], ['Kali', 5], ['Parvati', 4], ['Brahma', 2], ['Radha', 1.5],
      ['Kartikeya', 1.5, ['Murugan', 'Skanda', 'Kartik', 'Subramanya']], ['Venkateswara', 1.5, ['Balaji', 'Tirupati Balaji']],
      ['Ayyappa', 1, ['Ayyappan']], ['Jagannath', 1], ['Sita', 1], ['Indra', 0.8], ['Surya', 0.8], ['Agni', 0.5],
      ['Varuna', 0.4], ['Yama', 0.4], ['Narasimha', 0.3], ['Vayu', 0.3], ['Kubera', 0.2],
    ],
  },
  {
    id: 'indian-bread',
    category: 'India: Food',
    prompt: 'Name a type of Indian bread.',
    qualifier: 'Flatbreads and fried breads eaten with a meal.',
    answers: [
      ['Roti', 22, ['Chapati', 'Chapatti', 'Phulka']], ['Naan', 18], ['Paratha', 15, ['Parantha']], ['Puri', 10, ['Poori']],
      ['Kulcha', 5], ['Bhatura', 4, ['Bhature']], ['Rumali Roti', 2], ['Tandoori Roti', 2], ['Thepla', 1.5],
      ['Missi Roti', 1], ['Bhakri', 1], ['Bajra Roti', 1], ['Luchi', 0.5],
    ],
  },
  {
    id: 'cricket-stadium',
    category: 'India: Cricket',
    prompt: 'Name an international cricket stadium in India.',
    qualifier: 'Grounds in India that have hosted men\u2019s international matches. Use the ground\u2019s name.',
    answers: [
      ['Eden Gardens', 20, ['Eden']], ['Wankhede Stadium', 18, ['Wankhede']], ['M. Chinnaswamy Stadium', 10, ['Chinnaswamy', 'Chinnaswamy Stadium']],
      ['Narendra Modi Stadium', 10, ['Motera', 'Sardar Patel Stadium']], ['M. A. Chidambaram Stadium', 8, ['Chepauk', 'Chidambaram Stadium', 'MA Chidambaram Stadium']],
      ['Arun Jaitley Stadium', 6, ['Feroz Shah Kotla', 'Kotla']], ['Rajiv Gandhi International Stadium', 3, ['Uppal']],
      ['Brabourne Stadium', 2.5, ['Brabourne']], ['Punjab Cricket Association Stadium', 2.5, ['PCA Stadium', 'Mohali', 'Mohali Stadium']],
      ['HPCA Stadium', 2, ['Dharamsala', 'Dharamshala']], ['Sawai Mansingh Stadium', 1.5], ['JSCA International Stadium', 1.2, ['Ranchi Stadium']],
      ['Green Park Stadium', 1, ['Green Park']], ['Holkar Stadium', 1], ['Barabati Stadium', 0.8],
      ['Greenfield International Stadium', 0.8, ['Greenfield Stadium']], ['Ekana Stadium', 0.8, ['Ekana']],
    ],
  },
];

function publish(spec: QuestionSpec): PublishedQuestion {
  const priors = weightsToPpm(spec.answers.map((a) => a[1]));
  return {
    id: spec.id,
    version: QUESTION_VERSION,
    category: spec.category,
    prompt: spec.prompt,
    qualifier: spec.qualifier,
    answers: spec.answers.map(([text, , aliases], index) => ({
      id: slug(text),
      text,
      aliases: aliases ?? [],
      priorPpm: priors[index] as number,
    })),
  };
}

export const QUESTION_BANK: readonly PublishedQuestion[] = SPECS.map(publish);

/**
 * A question can only ever pay a rare tier if some valid answer is genuinely uncommon. In a small
 * closed set where every answer is common, no answer can reach tier 5 or 6, so the reward curve is
 * flat. Such questions are fine for practice but are NEVER put in the ranked daily. The cut-off is
 * a product choice: the smallest editorial prior must be under 2%.
 */
export const RARE_TAIL_PPM = 20_000;

export function hasRareTail(question: PublishedQuestion): boolean {
  return Math.min(...question.answers.map((a) => a.priorPpm)) < RARE_TAIL_PPM;
}

/** Questions eligible for the ranked daily. */
export const DAILY_POOL: readonly PublishedQuestion[] = QUESTION_BANK.filter(hasRareTail);
/** Every question may appear in practice. */
export const PRACTICE_POOL: readonly PublishedQuestion[] = QUESTION_BANK;

const byId = new Map(QUESTION_BANK.map((q) => [q.id, q]));
const indexCache = new Map<string, AnswerIndex>();

export function getQuestion(id: string): PublishedQuestion {
  const question = byId.get(id);
  if (!question) throw new Error(`unknown question: ${id}`);
  return question;
}

export function toPublicQuestion(question: PublishedQuestion): PublicQuestion {
  return {
    id: question.id,
    category: question.category,
    prompt: question.prompt,
    qualifier: question.qualifier,
  };
}

function toDefinitions(question: PublishedQuestion): AnswerDefinition[] {
  return question.answers.map((a) => ({ id: a.id, text: a.text, aliases: a.aliases }));
}

/** Cached per question version: a published version is immutable, so no invalidation is needed (§6.3). */
export function getAnswerIndex(questionId: string): AnswerIndex {
  let index = indexCache.get(questionId);
  if (!index) {
    index = buildAnswerIndex(toDefinitions(getQuestion(questionId)));
    indexCache.set(questionId, index);
  }
  return index;
}

export function getPriorPpm(questionId: string, answerId: string): number {
  const answer = getQuestion(questionId).answers.find((a) => a.id === answerId);
  if (!answer) throw new Error(`unknown answer ${answerId} for question ${questionId}`);
  return answer.priorPpm;
}

export function getAnswerText(questionId: string, answerId: string): string {
  const answer = getQuestion(questionId).answers.find((a) => a.id === answerId);
  if (!answer) throw new Error(`unknown answer ${answerId} for question ${questionId}`);
  return answer.text;
}

export interface BankProblem {
  readonly questionId: string;
  readonly problem: IndexProblem | { readonly kind: 'PRIORS_DO_NOT_SUM' | 'PRIOR_BELOW_FLOOR' | 'DUPLICATE_QUESTION_ID' };
}

/** The publication check (§5.7, §18.7) over the whole bank. An empty array means publishable. */
export function validateBank(bank: readonly PublishedQuestion[] = QUESTION_BANK): BankProblem[] {
  const problems: BankProblem[] = [];
  const seen = new Set<string>();
  for (const question of bank) {
    if (seen.has(question.id)) problems.push({ questionId: question.id, problem: { kind: 'DUPLICATE_QUESTION_ID' } });
    seen.add(question.id);
    for (const problem of analyzeAnswerSet(toDefinitions(question))) {
      problems.push({ questionId: question.id, problem });
    }
    const sum = question.answers.reduce((total, a) => total + a.priorPpm, 0);
    if (sum !== 1_000_000) problems.push({ questionId: question.id, problem: { kind: 'PRIORS_DO_NOT_SUM' } });
    if (question.answers.some((a) => a.priorPpm < 500)) {
      problems.push({ questionId: question.id, problem: { kind: 'PRIOR_BELOW_FLOOR' } });
    }
  }
  return problems;
}
